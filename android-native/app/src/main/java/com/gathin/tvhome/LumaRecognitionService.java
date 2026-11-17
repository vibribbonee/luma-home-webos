package com.gathin.tvhome;

import android.content.Intent;
import android.os.RemoteException;
import android.speech.RecognitionService;
import android.speech.SpeechRecognizer;

/** LumaX handles speech inside its Assist session. It does not offer general dictation. */
public final class LumaRecognitionService extends RecognitionService {
    @Override
    protected void onStartListening(Intent intent, Callback callback) {
        try {
            callback.error(SpeechRecognizer.ERROR_CLIENT);
        } catch (RemoteException ignored) {
            // The caller disconnected before the response.
        }
    }

    @Override
    protected void onStopListening(Callback callback) {}

    @Override
    protected void onCancel(Callback callback) {}
}
