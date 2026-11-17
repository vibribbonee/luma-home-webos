const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const worker = fs.readFileSync(path.join(__dirname, '../tools/voice-assist.js'), 'utf8');

async function runVoice({ paired, renderer, played }) {
    const local = [];
    const streamer = [];
    const speaker = [];
    class Assist extends EventEmitter {
        constructor(_socket, connection) {
            super();
            this.connection = connection;
        }
        async connect() {}
        async call(payload) {
            if (payload.type === 'luma_home/voice/config') {
                return { pipeline: 'fixture', stt_engine: 'speech', voice_reply: true, speaker_configured: played !== undefined };
            }
            if (payload.type === 'luma_home/voice/reply') {
                speaker.push(payload.media_id);
                return { played };
            }
            streamer.push(payload);
            return { renderer };
        }
        async run() {
            this.emit('stage', { type: 'intent-end', data: {
                intent_output: { response: { speech: { plain: { speech: 'Fixture reply' } } } },
            } });
            this.emit('stage', { type: 'tts-end', data: { tts_output: {
                url: '/api/tts_proxy/test.mp3', media_id: 'media-source://tts/-stream-/test.mp3',
            } } });
            this.emit('stage', { type: 'run-end' });
        }
        close() {}
    }
    const fakeFs = {
        readFileSync: () => JSON.stringify({ lumax_enabled: paired }),
        writeFileSync() {},
        existsSync: () => false,
    };
    const fakeProcess = {
        spawn(_binary, args) {
            local.push(JSON.parse(args.at(-1)).params.voice);
            return { on() {}, kill() {} };
        },
        spawnSync() {},
    };
    const modules = {
        fs: fakeFs,
        net: {},
        child_process: fakeProcess,
        './assist-client': Assist,
        './vendor/ws': {},
        '/media/developer/apps/usr/palm/applications/com.spinoff.lumahome/discover-ha.js': {
            async connection() { return { tv_id: 'room', url: 'http://ha.invalid' }; },
        },
    };
    await new Promise(resolve => vm.runInNewContext(worker, {
        require: name => modules[name],
        process: { argv: [], on() {}, exit: resolve },
        console: { log() {} },
        setTimeout(callback, ms) { return setTimeout(callback, ms <= 250 ? 0 : ms); },
        clearTimeout,
        setInterval,
        clearInterval,
    }));
    return { local, streamer, speaker };
}

(async () => {
    const paired = await runVoice({ paired: true, renderer: 'streamer-1' });
    assert.equal(paired.local.length, 0);
    assert.deepEqual(paired.streamer.map(event => event.phase), ['starting', 'reply']);
    assert.equal(paired.streamer[1].renderer, 'streamer-1');

    const fallback = await runVoice({ paired: true, renderer: null });
    assert.deepEqual(fallback.streamer.map(event => event.phase), ['starting']);
    assert.deepEqual(fallback.local.map(event => event.phase), ['starting', 'reply']);

    const standalone = await runVoice({ paired: false, renderer: null });
    assert.equal(standalone.streamer.length, 0);
    assert.deepEqual(standalone.local.map(event => event.phase), ['starting', 'reply']);
    assert.equal(standalone.local[1].audioUrl, 'http://ha.invalid/api/tts_proxy/test.mp3');
    assert.equal(standalone.speaker.length, 0);

    const delegated = await runVoice({ paired: true, renderer: 'streamer-1', played: true });
    assert.deepEqual(delegated.speaker, ['media-source://tts/-stream-/test.mp3']);
    assert.equal(delegated.streamer[1].audio_path, '');
    assert.equal(delegated.streamer[1].message, 'Fixture reply');

    const speakerUnavailable = await runVoice({ paired: true, renderer: null, played: false });
    assert.equal(speakerUnavailable.speaker.length, 1);
    assert.equal(speakerUnavailable.local[1].audioUrl, 'http://ha.invalid/api/tts_proxy/test.mp3');
    console.log('Passed: one Assist renderer, speaker delegation, and fallback to device audio.');
})().catch(error => { console.error(error); process.exitCode = 1; });
