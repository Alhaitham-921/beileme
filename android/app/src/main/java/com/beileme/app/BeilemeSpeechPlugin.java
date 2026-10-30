package com.beileme.app;

import android.os.Handler;
import android.os.Looper;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.Locale;

/** Uses the phone's speech engine, without sending text to a separate AI service. */
@CapacitorPlugin(name = "BeilemeSpeech")
public class BeilemeSpeechPlugin extends Plugin {
    private final Handler main = new Handler(Looper.getMainLooper());
    private TextToSpeech engine;
    private PluginCall pending;
    private String utteranceId;
    private int sequence;
    private int initialization;
    private boolean ready;
    private boolean destroyed;
    private final Runnable initTimeout = () -> failInitialization("系统朗读服务启动超时，请检查手机的文字转语音设置。");
    private final Runnable speechTimeout = () -> {
        if (engine != null) engine.stop();
        rejectPending("朗读超时，请重试。", "TTS_TIMEOUT");
    };

    @PluginMethod
    public void speak(PluginCall call) {
        main.post(() -> {
            if (destroyed) {
                call.reject("朗读服务已关闭，请重新打开应用。", "TTS_CLOSED");
                return;
            }
            String text = call.getString("text", "").trim();
            if (text.isEmpty()) {
                call.reject("没有可朗读的文字。", "TTS_EMPTY");
                return;
            }
            cancelPending();
            pending = call;
            if (ready) speakPending();
            else if (engine == null) initialize();
        });
    }

    private void initialize() {
        final int token = ++initialization;
        main.postDelayed(initTimeout, 10000);
        try {
            engine = new TextToSpeech(getContext(), status -> main.post(() -> {
                if (destroyed || token != initialization) return;
                main.removeCallbacks(initTimeout);
                if (status != TextToSpeech.SUCCESS) {
                    failInitialization("系统朗读服务不可用，请在手机的文字转语音设置中安装或启用朗读引擎。");
                    return;
                }
                ready = true;
                engine.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                    @Override public void onStart(String id) {}
                    @Override public void onDone(String id) {
                        main.post(() -> { if (id.equals(utteranceId)) resolvePending(false); });
                    }
                    @Override public void onError(String id) {
                        main.post(() -> {
                            if (id.equals(utteranceId)) rejectPending("系统朗读失败，请检查英语语音包后重试。", "TTS_FAILED");
                        });
                    }
                    @Override public void onStop(String id, boolean interrupted) {
                        main.post(() -> { if (id.equals(utteranceId)) resolvePending(true); });
                    }
                });
                speakPending();
            }));
        } catch (RuntimeException error) {
            failInitialization("系统朗读服务不可用，请在手机的文字转语音设置中安装或启用朗读引擎。");
        }
    }

    private void failInitialization(String message) {
        initialization++;
        main.removeCallbacks(initTimeout);
        ready = false;
        if (engine != null) engine.shutdown();
        engine = null;
        rejectPending(message, "TTS_UNAVAILABLE");
    }

    private void speakPending() {
        if (pending == null || !ready || engine == null) return;
        int language = engine.setLanguage(Locale.US);
        if (language == TextToSpeech.LANG_MISSING_DATA || language == TextToSpeech.LANG_NOT_SUPPORTED) {
            rejectPending("手机缺少英语语音包，请在系统的文字转语音设置中下载英语（美国）语音。", "TTS_LANGUAGE_MISSING");
            return;
        }
        String text = pending.getString("text", "").trim();
        text = text.substring(0, Math.min(text.length(), TextToSpeech.getMaxSpeechInputLength()));
        double requestedRate = pending.getDouble("rate", 1.0);
        float rate = (float) (Double.isFinite(requestedRate) ? Math.max(0.5, Math.min(1.5, requestedRate)) : 1.0);
        engine.setSpeechRate(rate);
        utteranceId = "beileme-" + (++sequence);
        if (engine.speak(text, TextToSpeech.QUEUE_FLUSH, null, utteranceId) == TextToSpeech.ERROR) {
            rejectPending("系统朗读失败，请检查英语语音包后重试。", "TTS_FAILED");
        } else {
            // Engines should always send a terminal callback; this also bounds faulty engines.
            main.postDelayed(speechTimeout, 600000);
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        main.post(() -> {
            cancelPending();
            call.resolve();
        });
    }

    private void cancelPending() {
        if (engine != null) engine.stop();
        resolvePending(true);
    }

    private void resolvePending(boolean cancelled) {
        PluginCall call = pending;
        pending = null;
        utteranceId = null;
        main.removeCallbacks(speechTimeout);
        if (call != null) {
            JSObject result = new JSObject();
            result.put("cancelled", cancelled);
            call.resolve(result);
        }
    }

    private void rejectPending(String message, String code) {
        PluginCall call = pending;
        pending = null;
        utteranceId = null;
        main.removeCallbacks(speechTimeout);
        if (call != null) call.reject(message, code);
    }

    @Override
    protected void handleOnPause() {
        main.post(this::cancelPending);
    }

    @Override
    protected void handleOnDestroy() {
        main.post(() -> {
            destroyed = true;
            initialization++;
            main.removeCallbacks(initTimeout);
            cancelPending();
            if (engine != null) engine.shutdown();
            engine = null;
            ready = false;
        });
    }
}
