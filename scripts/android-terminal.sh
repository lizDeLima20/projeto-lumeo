#!/usr/bin/env bash
# Terminal-only Android workflow for Lumeo. It intentionally never opens
# Android Studio and always launches Gradle with JDK 21.
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
default_java_home="/home/delima/.local/share/lumeo/jdk-21/usr/lib/jvm/java-21-openjdk-amd64"
export JAVA_HOME="${LUMEO_JAVA_HOME:-$default_java_home}"
export PATH="$JAVA_HOME/bin:$PATH"
apk_path="$project_root/android/app/build/outputs/apk/debug/app-debug.apk"
package_name="com.lumeo.reader"

require_java_21() {
  if [[ ! -x "$JAVA_HOME/bin/java" || ! -x "$JAVA_HOME/bin/javac" ]]; then
    echo "JDK 21 não encontrado em: $JAVA_HOME" >&2
    echo "Defina LUMEO_JAVA_HOME para um JDK 21 válido." >&2
    exit 1
  fi
  local version
  version="$($JAVA_HOME/bin/java -version 2>&1 | sed -n '1s/.*version "\([0-9][0-9]*\).*/\1/p')"
  if [[ "$version" != "21" ]]; then
    echo "O projeto Android exige Java 21; JAVA_HOME atual é Java ${version:-desconhecido}." >&2
    exit 1
  fi
}

java_info() {
  require_java_21
  echo "JAVA_HOME=$JAVA_HOME"
  java -version
  javac -version
}

sync_android() {
  require_java_21
  cd "$project_root"
  npm run build:android
  npx cap sync android
}

build_apk() {
  sync_android
  cd "$project_root/android"
  ./gradlew --no-daemon assembleDebug
  test -f "$apk_path"
  echo "APK=$apk_path"
}

require_device() {
  local device_count
  device_count="$(adb devices | awk 'NR>1 && $2 == "device" { count++ } END { print count + 0 }')"
  if [[ "$device_count" == "0" ]]; then
    echo "Nenhum dispositivo Android autorizado. Conecte o celular, habilite Depuração USB e aceite a chave RSA." >&2
    exit 1
  fi
}

install_apk() {
  test -f "$apk_path" || { echo "APK não encontrado: rode npm run android:build primeiro." >&2; exit 1; }
  require_device
  adb install -r "$apk_path"
}

start_app() {
  require_device
  adb shell monkey -p "$package_name" -c android.intent.category.LAUNCHER 1 >/dev/null
  echo "Aplicativo iniciado: $package_name"
}

case "${1:-}" in
  java) java_info ;;
  sync) sync_android ;;
  build) build_apk ;;
  install) install_apk ;;
  logs)
    require_device
    exec adb logcat -v color -s NativeBookDownload:V Lumeo:V Capacitor:V chromium:W '*:S'
    ;;
  dev)
    build_apk
    install_apk
    start_app
    ;;
  *)
    echo "Uso: $0 {java|sync|build|install|logs|dev}" >&2
    exit 64
    ;;
esac
