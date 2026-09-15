package com.lumeo.reader;

import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.net.SocketTimeoutException;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import okhttp3.Call;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.ResponseBody;

/**
 * Downloads a known catalogue item directly from Google Drive into Android's
 * app-private files directory. It never uses Downloads or external storage.
 */
@CapacitorPlugin(name = "NativeBookDownload")
public class NativeBookDownloadPlugin extends Plugin {
    private static final String TAG = "NativeBookDownload";
    private static final String DIRECTORY_NAME = "lumeo-books";
    private static final long STALE_PART_FILE_MS = TimeUnit.DAYS.toMillis(1);
    private final ExecutorService executor = Executors.newCachedThreadPool();
    private final Map<String, Call> activeCalls = new ConcurrentHashMap<>();
    private final OkHttpClient http = new OkHttpClient.Builder()
        .followRedirects(true)
        .followSslRedirects(true)
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(90, TimeUnit.SECONDS)
        .build();

    @Override
    public void load() {
        cleanStalePartialDownloads();
    }

    @Override
    protected void handleOnDestroy() {
        for (Call call : activeCalls.values()) call.cancel();
        activeCalls.clear();
        executor.shutdownNow();
        super.handleOnDestroy();
    }

    @PluginMethod
    public void downloadBook(PluginCall pluginCall) {
        final String bookId = pluginCall.getString("bookId");
        final String url = pluginCall.getString("url");
        if (bookId == null || bookId.trim().isEmpty() || url == null || url.trim().isEmpty()) {
            pluginCall.reject("Dados do livro inválidos.", "DOWNLOAD_REQUEST_INVALID");
            return;
        }
        if (!url.startsWith("https://")) {
            pluginCall.reject("A origem do livro precisa usar HTTPS.", "DOWNLOAD_URL_INVALID");
            return;
        }
        final String safeBookId = safeBookId(bookId);
        final File directory = downloadDirectory();
        if (!directory.exists() && !directory.mkdirs()) {
            pluginCall.reject("Não foi possível preparar o armazenamento local.", "DOWNLOAD_STORAGE_UNAVAILABLE");
            return;
        }
        final File existing = completedFile(directory, safeBookId);
        if (existing != null) {
            resolve(pluginCall, bookId, existing, null, mimeTypeFor(existing), true);
            return;
        }
        final Long expectedSize = pluginCall.getLong("expectedSize");
        final String expectedSha256 = normalizeHash(pluginCall.getString("sha256"));
        final Request request = new Request.Builder().url(url).get().header("Accept", "application/pdf,application/epub+zip,application/octet-stream;q=0.8").build();
        final Call httpCall = http.newCall(request);
        // Log only the host and technical state: never the full signed URL,
        // session data, or book bytes.
        Log.i(TAG, "LUMEO_NATIVE_DOWNLOAD stage=NATIVE_PLUGIN_CALLED bookId=" + safeBookId);
        Log.i(TAG, "LUMEO_NATIVE_DOWNLOAD stage=DOWNLOAD_STARTED bookId=" + safeBookId + " sourceHost=" + request.url().host());
        activeCalls.put(bookId, httpCall);
        executor.execute(() -> download(pluginCall, bookId, safeBookId, directory, httpCall, expectedSize, expectedSha256));
    }

    @PluginMethod
    public void cancelDownload(PluginCall pluginCall) {
        final String bookId = pluginCall.getString("bookId");
        if (bookId == null || bookId.trim().isEmpty()) {
            pluginCall.reject("Identificador do livro ausente.", "DOWNLOAD_REQUEST_INVALID");
            return;
        }
        final Call active = activeCalls.remove(bookId);
        if (active != null) active.cancel();
        deletePartFile(safeBookId(bookId));
        JSObject result = new JSObject();
        result.put("bookId", bookId);
        result.put("cancelled", true);
        pluginCall.resolve(result);
    }

    private void download(PluginCall pluginCall, String bookId, String safeBookId, File directory, Call httpCall, Long expectedSize, String expectedSha256) {
        final File part = new File(directory, safeBookId + ".part");
        try (Response response = httpCall.execute()) {
            final int status = response.code();
            final int redirects = redirectCount(response);
            final String finalHost = response.request().url().host();
            final String rawContentType = response.header("Content-Type", "");
            final String rawContentLength = response.header("Content-Length", "unknown");
            Log.i(TAG, "LUMEO_NATIVE_DOWNLOAD stage=REDIRECT bookId=" + safeBookId + " finalHost=" + finalHost + " redirects=" + redirects);
            Log.i(TAG, "LUMEO_NATIVE_DOWNLOAD stage=HTTP_STATUS bookId=" + safeBookId + " status=" + status + " contentType=" + safeHeader(rawContentType) + " contentLength=" + safeHeader(rawContentLength));
            if (redirects > 10) throw new DownloadFailure("DOWNLOAD_REDIRECT_ERROR", "A origem redirecionou a requisição muitas vezes.");
            if (status != 200 && status != 206) throw new DownloadFailure("DOWNLOAD_HTTP_ERROR", "A origem retornou HTTP " + status + ".");
            final String contentType = rawContentType.toLowerCase(Locale.ROOT);
            if (contentType.contains("text/html") || contentType.contains("application/xhtml")) {
                throw new DownloadFailure("DOWNLOAD_HTML_RESPONSE", "A origem retornou uma página em vez do livro.");
            }
            final ResponseBody body = response.body();
            if (body == null) throw new DownloadFailure("DOWNLOAD_EMPTY_RESPONSE", "A origem não retornou conteúdo.");
            final long total = body.contentLength();
            final MessageDigest digest = sha256();
            long downloaded = 0;
            final byte[] signature = new byte[8];
            int signatureLength = 0;
            Log.i(TAG, "download.part bookId=" + safeBookId + " created=true");
            try (BufferedInputStream input = new BufferedInputStream(body.byteStream()); FileOutputStream output = new FileOutputStream(part, false)) {
                final byte[] buffer = new byte[64 * 1024];
                int count;
                while ((count = input.read(buffer)) != -1) {
                    if (httpCall.isCanceled()) throw new DownloadFailure("DOWNLOAD_CANCELLED", "Download cancelado.");
                    output.write(buffer, 0, count);
                    digest.update(buffer, 0, count);
                    if (signatureLength < signature.length) {
                        final int copied = Math.min(signature.length - signatureLength, count);
                        System.arraycopy(buffer, 0, signature, signatureLength, copied);
                        signatureLength += copied;
                    }
                    downloaded += count;
                    notifyProgress(bookId, downloaded, total);
                }
                output.getFD().sync();
            }
            if (downloaded <= 0) throw new DownloadFailure("DOWNLOAD_EMPTY_FILE", "O arquivo baixado está vazio.");
            Log.i(TAG, "LUMEO_NATIVE_DOWNLOAD stage=BYTES_RECEIVED bookId=" + safeBookId + " bytes=" + downloaded);
            if (expectedSize != null && expectedSize > 0 && downloaded != expectedSize) {
                throw new DownloadFailure("DOWNLOAD_SIZE_MISMATCH", "O tamanho do arquivo não confere.");
            }
            final String mimeType = documentMimeType(signature, signatureLength, contentType);
            final String hash = hex(digest.digest());
            Log.i(TAG, "LUMEO_NATIVE_DOWNLOAD stage=FILE_VALIDATED bookId=" + safeBookId + " bytes=" + downloaded + " mimeType=" + mimeType + " expectedSha256=" + presence(expectedSha256));
            if (expectedSha256 != null && !expectedSha256.equals(hash)) {
                throw new DownloadFailure("DOWNLOAD_HASH_MISMATCH", "A integridade do arquivo não confere.");
            }
            final File destination = new File(directory, safeBookId + ("application/pdf".equals(mimeType) ? ".pdf" : ".epub"));
            moveAtomically(part, destination);
            resolve(pluginCall, bookId, destination, hash, mimeType, false);
            notifyCompleted(bookId, destination, downloaded, hash, mimeType);
            Log.i(TAG, "LUMEO_NATIVE_DOWNLOAD stage=FILE_SAVED bookId=" + safeBookId + " bytes=" + downloaded + " mimeType=" + mimeType);
        } catch (DownloadFailure failure) {
            deleteQuietly(part);
            notifyFailed(bookId, failure.code);
            Log.w(TAG, "download.failed bookId=" + safeBookId + " code=" + failure.code);
            pluginCall.reject(failure.getMessage(), failure.code);
        } catch (IOException failure) {
            deleteQuietly(part);
            final String code = httpCall.isCanceled() ? "DOWNLOAD_CANCELLED" : failure instanceof SocketTimeoutException ? "DOWNLOAD_TIMEOUT" : ioCode(failure);
            notifyFailed(bookId, code);
            Log.w(TAG, "download.failed bookId=" + safeBookId + " code=" + code + " exception=" + failure.getClass().getSimpleName() + " message=" + safeMessage(failure.getMessage()));
            pluginCall.reject(httpCall.isCanceled() ? "Download cancelado." : "Não foi possível baixar o livro.", code);
        } catch (Exception failure) {
            deleteQuietly(part);
            notifyFailed(bookId, "DOWNLOAD_UNKNOWN");
            Log.w(TAG, "download.failed bookId=" + safeBookId + " code=DOWNLOAD_UNKNOWN exception=" + failure.getClass().getSimpleName());
            pluginCall.reject("Não foi possível salvar o livro neste dispositivo.", "DOWNLOAD_UNKNOWN");
        } finally {
            activeCalls.remove(bookId);
        }
    }

    private File downloadDirectory() { return new File(getContext().getFilesDir(), DIRECTORY_NAME); }
    private File completedFile(File directory, String safeBookId) {
        final File pdf = new File(directory, safeBookId + ".pdf");
        if (pdf.isFile() && pdf.length() > 0) return pdf;
        final File epub = new File(directory, safeBookId + ".epub");
        return epub.isFile() && epub.length() > 0 ? epub : null;
    }
    private void deletePartFile(String safeBookId) { deleteQuietly(new File(downloadDirectory(), safeBookId + ".part")); }
    private void cleanStalePartialDownloads() {
        final File[] files = downloadDirectory().listFiles((directory, name) -> name.endsWith(".part"));
        if (files == null) return;
        final long threshold = System.currentTimeMillis() - STALE_PART_FILE_MS;
        for (File file : files) if (file.lastModified() < threshold) deleteQuietly(file);
    }
    private void notifyProgress(String bookId, long downloaded, long total) {
        JSObject event = new JSObject(); event.put("bookId", bookId); event.put("bytesDownloaded", downloaded); event.put("totalBytes", total > 0 ? total : null);
        event.put("percentage", total > 0 ? Math.min(100, (int) ((downloaded * 100) / total)) : null);
        notifyListeners("bookDownloadProgress", event);
    }
    private void notifyCompleted(String bookId, File file, long size, String hash, String mimeType) {
        JSObject event = new JSObject(); event.put("bookId", bookId); event.put("uri", file.toURI().toString()); event.put("size", size); event.put("sha256", hash); event.put("mimeType", mimeType); notifyListeners("bookDownloadCompleted", event);
    }
    private void notifyFailed(String bookId, String code) { JSObject event = new JSObject(); event.put("bookId", bookId); event.put("code", code); notifyListeners("bookDownloadFailed", event); }
    private void resolve(PluginCall call, String bookId, File file, String hash, String mimeType, boolean existing) {
        JSObject result = new JSObject(); result.put("bookId", bookId); result.put("uri", file.toURI().toString()); result.put("size", file.length()); result.put("sha256", hash); result.put("mimeType", mimeType); result.put("existing", existing); call.resolve(result);
    }
    private MessageDigest sha256() throws DownloadFailure { try { return MessageDigest.getInstance("SHA-256"); } catch (NoSuchAlgorithmException error) { throw new DownloadFailure("DOWNLOAD_HASH_UNAVAILABLE", "Não foi possível validar o arquivo."); } }
    private String documentMimeType(byte[] signature, int length, String responseType) throws DownloadFailure {
        final boolean pdf = length >= 5 && signature[0] == '%' && signature[1] == 'P' && signature[2] == 'D' && signature[3] == 'F' && signature[4] == '-';
        final boolean zip = length >= 4 && signature[0] == 'P' && signature[1] == 'K' && signature[2] == 3 && signature[3] == 4;
        if (pdf) return "application/pdf";
        if (zip) return "application/epub+zip";
        if (responseType.contains("text/html")) throw new DownloadFailure("DOWNLOAD_HTML_RESPONSE", "A origem retornou uma página em vez do livro.");
        if (responseType.length() > 0 && !responseType.contains("pdf") && !responseType.contains("epub") && !responseType.contains("octet-stream")) throw new DownloadFailure("DOWNLOAD_INVALID_MIME", "A origem retornou um tipo de conteúdo inválido.");
        throw new DownloadFailure("DOWNLOAD_INVALID_SIGNATURE", "O arquivo baixado não é um PDF ou EPUB válido.");
    }
    private String mimeTypeFor(File file) { return file.getName().endsWith(".epub") ? "application/epub+zip" : "application/pdf"; }
    private String normalizeHash(String value) { return value == null || value.trim().isEmpty() ? null : value.trim().toLowerCase(Locale.ROOT); }
    private String safeBookId(String value) { return value.replaceAll("[^A-Za-z0-9._-]", "_"); }
    private String hex(byte[] bytes) { StringBuilder value = new StringBuilder(bytes.length * 2); for (byte item : bytes) value.append(String.format(Locale.ROOT, "%02x", item)); return value.toString(); }
    /** Same-directory rename is atomic on Android's app-private filesystem. */
    private void moveAtomically(File source, File destination) throws IOException { if (destination.exists() && !destination.delete()) throw new IOException("Could not replace previous file"); if (!source.renameTo(destination)) throw new IOException("Could not finalize downloaded file"); }
    private void deleteQuietly(File file) { if (file.exists()) file.delete(); }
    private int redirectCount(Response response) { int count = 0; for (Response prior = response.priorResponse(); prior != null; prior = prior.priorResponse()) count++; return count; }
    private String safeHeader(String value) { return value == null ? "unknown" : value.replaceAll("[^A-Za-z0-9+./;=_ -]", "").substring(0, Math.min(100, value.replaceAll("[^A-Za-z0-9+./;=_ -]", "").length())); }
    private String presence(String value) { return value == null ? "absent" : "present"; }
    private String abbreviatedHash(String value) { return value == null || value.length() < 12 ? presence(value) : value.substring(0, 12) + "…"; }
    private String safeMessage(String value) { if (value == null) return "none"; String safe = value.replaceAll("https?://\\S+", "[url]").replaceAll("[\\r\\n]", " "); return safe.substring(0, Math.min(160, safe.length())); }
    private String ioCode(IOException failure) { String message = failure.getMessage() == null ? "" : failure.getMessage().toLowerCase(Locale.ROOT); return message.contains("no space") || message.contains("enospc") ? "DOWNLOAD_NO_SPACE" : "DOWNLOAD_IO_ERROR"; }

    private static final class DownloadFailure extends Exception {
        final String code;
        DownloadFailure(String code, String message) { super(message); this.code = code; }
    }
}
