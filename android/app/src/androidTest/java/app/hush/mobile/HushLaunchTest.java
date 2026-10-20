package app.hush.mobile;

import static org.junit.Assert.*;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import android.webkit.WebView;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class HushLaunchTest {
    @Test public void bundledAppLoadsWithSecureCryptoAndUsableLogin() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            boolean ready = false;
            for (int attempt = 0; attempt < 60 && !ready; attempt++) {
                CountDownLatch done = new CountDownLatch(1);
                AtomicReference<String> value = new AtomicReference<>();
                scenario.onActivity(activity -> {
                    WebView web = activity.getBridge().getWebView();
                    web.evaluateJavascript("Boolean(window.isSecureContext && window.crypto?.subtle && document.querySelector('input[type=password]') && document.documentElement.classList.contains('native-app') && document.querySelector('input[type=password]').getBoundingClientRect().width > 100 && document.querySelector('input[type=password]').getBoundingClientRect().bottom < innerHeight)", result -> { value.set(result); done.countDown(); });
                });
                assertTrue("WebView did not answer", done.await(5, TimeUnit.SECONDS));
                ready = "true".equals(value.get());
                if (!ready) Thread.sleep(500);
            }
            assertTrue("Bundled login failed to load or secure encryption API missing", ready);
            scenario.onActivity(activity -> activity.getBridge().getWebView().evaluateJavascript(
                "window.hushNativeSmoke='running';(async()=>{const c=window.Capacitor;await c.nativePromise('Filesystem','writeFile',{path:'hush-smoke.bin',directory:'CACHE',data:'AAE='});await c.nativePromise('Filesystem','appendFile',{path:'hush-smoke.bin',directory:'CACHE',data:'AgM='});const f=await c.nativePromise('Filesystem','readFile',{path:'hush-smoke.bin',directory:'CACHE'});await c.nativePromise('Filesystem','deleteFile',{path:'hush-smoke.bin',directory:'CACHE'});if(f.data!=='AAECAw==')throw Error('binary mismatch');await c.nativePromise('Clipboard','write',{string:'Hush smoke test'});const text=await c.nativePromise('Clipboard','read',{});if(text.value!=='Hush smoke test')throw Error('clipboard mismatch');window.hushNativeSmoke='passed';})().catch(()=>window.hushNativeSmoke='failed');void 0;", null));
            String result = "running";
            for (int attempt = 0; attempt < 30 && "running".equals(result); attempt++) {
                CountDownLatch done = new CountDownLatch(1);
                AtomicReference<String> value = new AtomicReference<>();
                scenario.onActivity(activity -> activity.getBridge().getWebView().evaluateJavascript("window.hushNativeSmoke", answer -> { value.set(answer); done.countDown(); }));
                assertTrue(done.await(5, TimeUnit.SECONDS));
                result = value.get() == null ? "running" : value.get().replace("\"", "");
                if ("running".equals(result)) Thread.sleep(250);
            }
            assertEquals("Native file/clipboard bridge failed", "passed", result);
        }
    }
}
