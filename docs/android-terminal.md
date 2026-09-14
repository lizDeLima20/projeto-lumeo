# Lumeo Android pelo terminal

O projeto usa Java 21 e não requer Android Studio. O padrão local é
`/home/delima/.local/share/lumeo/jdk-21/usr/lib/jvm/java-21-openjdk-amd64`.
Em outra máquina, defina `LUMEO_JAVA_HOME` para outro JDK 21 antes de usar os
scripts.

O workspace do VS Code também configura esse JDK para novos terminais
integrados. Feche e abra um novo terminal depois de atualizar o workspace.

```bash
npm run android:java
npm run android:sync
npm run android:build
npm run android:install
npm run android:logs
```

`npm run android:dev` faz build web, `cap sync`, `assembleDebug`, instala o
APK e inicia `com.lumeo.reader` no primeiro dispositivo ADB autorizado.

## Ambiente online do APK

O build Android usa o modo Vite `android`. Copie `.env.android.example` para
`.env.android.local`; este arquivo não é versionado. A configuração mínima é:

```bash
VITE_APP_ENV=production
VITE_CAPACITOR_API_URL=https://lumeo-livros.vercel.app/api
VITE_GOOGLE_CLIENT_ID=SEU_CLIENT_ID_PUBLICO.apps.googleusercontent.com
```

`VITE_GOOGLE_CLIENT_ID` é uma identificação pública, nunca um client secret.
O APK não funciona com a URL relativa `/api`, pois o WebView roda em
`https://localhost`. Na Vercel, inclua exatamente `https://localhost` em
`ALLOWED_ORIGINS` junto do domínio de produção, por exemplo:

```text
https://lumeo-livros.vercel.app,https://localhost
```

O consentimento OAuth externo do Google também deve estar em **Production**;
em **Testing**, somente as contas adicionadas em “Test users” podem entrar.
Isso é uma regra do Google Cloud, não uma restrição do código do Lumeo.

No mesmo OAuth Web Client, adicione `https://localhost` em **Authorized
JavaScript origins**. O Capacitor Android usa essa origem segura por padrão.
Depois de salvar as variáveis da Vercel e a origem do Google, gere um novo
deploy da BFF e repita `npm run android:build` + `npm run android:install`.

Os logs seguros para conferir o resultado são:

```bash
npm run android:logs
```

Procure `LUMEO_ANDROID_RUNTIME` (BFF, Supabase e flag de Client ID) e
`LUMEO_ANDROID_BFF_READY` com `"ok":true`. Nenhum token é registrado.

O APK de depuração é gerado em:

`android/app/build/outputs/apk/debug/app-debug.apk`

Para executar o Gradle diretamente no terminal, mantenha o mesmo JDK:

```bash
export JAVA_HOME=/home/delima/.local/share/lumeo/jdk-21/usr/lib/jvm/java-21-openjdk-amd64
export PATH="$JAVA_HOME/bin:$PATH"
cd android
./gradlew assembleDebug
```

Para verificar o dispositivo e iniciar o aplicativo manualmente:

```bash
adb devices
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
adb shell monkey -p com.lumeo.reader -c android.intent.category.LAUNCHER 1
```

O filtro de logs do Lumeo é:

```bash
adb logcat -v color -s NativeBookDownload:V Lumeo:V Capacitor:V chromium:W '*:S'
```
