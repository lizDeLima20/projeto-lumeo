# Lumeo para Android (Capacitor)

O Android usa o mesmo frontend Vite da PWA. Não há um segundo aplicativo web.

## Preparação

Use Node 20+ e JDK 21. O Android Gradle Plugin desta versão não é compatível
com JDK 25. No Android Studio, instale uma imagem de emulador ou conecte um
aparelho com Depuração USB habilitada.

Antes do build Android, configure a URL pública da BFF no ambiente usado pelo
Vite. Ela é pública e não contém segredo:

```bash
VITE_CAPACITOR_API_URL=https://lumeo-livros.vercel.app/api
```

```bash
npm install
VITE_CAPACITOR_API_URL=https://lumeo-livros.vercel.app/api npm run android:sync
npm run android:open
```

No Android Studio, execute a configuração `app` em um emulador ou aparelho.
Também é possível gerar os artefatos na raiz do projeto:

```bash
export JAVA_HOME=/caminho/para/jdk-21
export PATH="$JAVA_HOME/bin:$PATH"
./android/gradlew -p android :app:assembleDebug
./android/gradlew -p android :app:bundleRelease
```

O APK de teste fica em `android/app/build/outputs/apk/debug/`. O AAB de
release fica em `android/app/build/outputs/bundle/release/` depois de configurar
uma assinatura de release no Android Studio/Gradle.

## Download do catálogo no Android

No Android Capacitor, `NativeBookDownload` recebe apenas o item conhecido do
catálogo e a URL HTTPS já resolvida. O tráfego é direto:

`Google Drive → Android → filesDir/lumeo-books → ImportManager → OPFS/IndexedDB`

O plugin usa OkHttp com redirects, grava em `*.part`, calcula SHA-256 durante o
stream e aceita somente PDF/EPUB válidos. Após a validação, faz rename no mesmo
diretório e entrega o arquivo ao pipeline normal do Lumeo. Não usa Downloads,
Documents, seletor de pasta, OAuth Google do leitor, `MANAGE_EXTERNAL_STORAGE`,
`READ_MEDIA` ou servidor intermediário. A única permissão é `INTERNET`.

Arquivos `.part` com mais de 24 horas são limpos na abertura do plugin; o botão
de download também pode cancelar a transferência atual. Para validar em aparelho
real, baixe um item do catálogo, reinicie o app, ative modo avião e abra o livro
que já foi importado na biblioteca.
