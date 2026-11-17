package com.gathin.tvhome;

import android.os.Bundle;
import android.service.voice.VoiceInteractionSession;
import android.service.voice.VoiceInteractionSessionService;
import android.widget.Toast;

public final class LumaVoiceSessionService extends VoiceInteractionSessionService {
    @Override
    public VoiceInteractionSession onNewSession(Bundle args) {
        return new VoiceInteractionSession(this) {
            @Override
            public void onCreate() {
                super.onCreate();
                setUiEnabled(false);
                setDisabledShowContext(SHOW_WITH_ASSIST | SHOW_WITH_SCREENSHOT);
            }

            @Override
            public void onShow(Bundle arguments, int flags) {
                super.onShow(arguments, flags);
                if (!HomeKeyService.startLumaAssist()) {
                    Toast.makeText(LumaVoiceSessionService.this,
                            "Enable Home button shortcuts in LumaX settings first.",
                            Toast.LENGTH_SHORT).show();
                }
                hide();
            }
        };
    }
}
