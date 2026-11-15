const assert = require('node:assert/strict');
const path = require('node:path');
const {launch} = require('./_launch.cjs');

async function main() {
    const assets = path.join(__dirname, '..', 'android', 'assets');
    const browser = await launch();
    try {
        const page = await browser.newPage({viewport:{width:1280,height:720}});
        await page.route('https://lumax.test/**', async route => {
            const file = new URL(route.request().url()).pathname.substring(1) || 'index.html';
            await route.fulfill({path:path.join(assets,file)});
        });
        await page.addInitScript(() => {
            const demo = {url:'https://demo-ha.invalid', token:'fixture', tv:'test-tv', input:'1'};
            const native = [{id:'test.video',name:'Video'},{id:'test.music',name:'Music'}];
            window.commands = [];
            window.LumaX = {
                catalog:() => JSON.stringify(native),
                preferences:() => JSON.stringify(demo),
                save:() => true,
                launch:id => window.commands.push({app:id}),
                googleHome:() => window.commands.push({home:'google'}),
                homeSettings:() => window.commands.push({home:'settings'}),
            };
            window.WebSocket = class {
                static OPEN = 1;
                readyState = 1;
                constructor() {
                    window.lumaSocket = this;
                    queueMicrotask(() => this.emit({type:'auth_required'}));
                }
                close() {}
                emit(msg) { this.onmessage({data:JSON.stringify(msg)}); }
                send(message) {
                    const data = JSON.parse(message);
                    window.commands.push(data);
                    if (data.type === 'auth') {
                        queueMicrotask(() => this.emit({type:'auth_ok'}));
                        return;
                    }
                    const replies = {
                        'luma_home/list': [{tv_id:'test-tv', name:'Test TV'}],
                        'luma_home/config/get': {
                            tv_id:'test-tv',entry_id:'entry',
                            settings:{room:'Demo Room',hdmi1:'Streamer',hdmi2:'Console',
                                temperature:'sensor.room_temperature',controls:['light.hall']},
                            catalog:[{id:'test.lg.app',title:'LG player',visible:true}],
                        },
                        'luma_home/states': [
                            {entity_id:'light.hall',state:'on',attributes:{friendly_name:'Hall light'}},
                            {entity_id:'sensor.room_temperature',state:'21',attributes:{unit_of_measurement:'°C'}},
                        ],
                        'luma_home/lumax/subscribe': {renderer:'test-renderer'},
                        'luma_home/lumax/ack': {accepted:true},
                    };
                    if (data.type === 'luma_home/lumax/subscribe') this.subscription = data.id;
                    queueMicrotask(() => this.emit({type:'result',id:data.id,success:true,result:replies[data.type]}));
                }
            };
        });
        await page.goto('https://lumax.test/');
        await page.getByRole('button',{name:'Console',exact:true}).waitFor();
        assert.equal(await page.getByRole('button',{name:'Streamer',exact:true}).count(), 0);
        assert.equal(await page.getByRole('button',{name:'Inputs',exact:true}).count(), 0);
        await page.getByText('Temperature 21 °C').waitFor();
        const video = page.getByRole('button',{name:'Video',exact:true});
        await video.focus();
        assert.equal(await page.locator('#shelf').innerText(), 'Video');
        await page.keyboard.press('ArrowRight');
        assert.equal(await page.locator('#shelf').innerText(), 'Music');
        await page.keyboard.press('Enter');
        await page.getByRole('button',{name:'Console'}).click();
        await page.getByRole('button',{name:'LG player'}).click();
        await page.waitForFunction(() => window.lumaSocket.subscription);
        await page.evaluate(() => {
            const socket = window.lumaSocket;
            socket.emit({type:'event',id:socket.subscription,event:{kind:'quick',nonce:'quick-test'}});
        });
        await page.getByRole('button',{name:/Hall light/}).click();
        const commands = await page.evaluate(() => window.commands);
        assert.ok(commands.some(c => c.app === 'test.music'));
        assert.ok(commands.some(c => c.service === 'select_input' && c.service_data.input === 2));
        assert.ok(commands.some(c => c.service === 'launch_app' && c.service_data.app === 'test.lg.app'));
        assert.ok(commands.some(c => c.domain === 'light' && c.service === 'toggle'));
        assert.ok(commands.some(c => c.type === 'luma_home/lumax/ack' && c.nonce === 'quick-test'));
        await page.getByRole('button',{name:'Close',exact:true}).click();
        await page.getByRole('button',{name:'Settings',exact:true}).click();
        await page.getByRole('button',{name:'Open Google TV Home'}).click();
        assert.ok((await page.evaluate(() => window.commands)).some(c => c.home === 'google'));
        await page.getByRole('button',{name:'Disconnect Home Assistant'}).click();
        assert.equal(await page.getByRole('button',{name:'Console'}).count(), 0);
        assert.equal(await page.getByRole('button',{name:'Video'}).count(), 1);
        console.log('LumaX passes catalog, D-pad, HDMI, controls, overlay, and disconnect tests.');
    } finally {
        await browser.close();
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
