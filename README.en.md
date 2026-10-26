# Universal OBD Dashboard

Open-source car telemetry for Android and Android Auto. It reads OBD-II data through a Bluetooth ELM327-compatible adapter, shows it on configurable dashboards and records every trip locally. Everything vehicle-specific lives in **JSON profiles**, so the code knows nothing about a particular car. The first vehicle profiled is a Fiat Uno Vivace 1.0 Flex (Magneti Marelli IAW 7GF).

The app UI and most documentation are in Brazilian Portuguese; this page is a short English overview. Full details are in [README.md](README.md).

| Minimal (day) | Capsule (night) | HUD (night) |
|---|---|---|
| ![Minimal](docs/img/tema-minimal-dia.png) | ![Capsule](docs/img/tema-capsule-noite.png) | ![HUD](docs/img/tema-hud-noite.png) |

## Features

- **Dashboards:** three themes (Minimal, Capsule, HUD) with day/night modes, landscape full screen and three pages (road, engine, trip).
- **Background capture:** a foreground service keeps reading with the screen off. Capture starts automatically when the adapter or the car's head unit connects and resumes after short disconnections.
- **Trip black box:** a local Room/SQLite database with trips, 2-second telemetry samples, trouble codes and freeze frames, plus CSV/GPX export.
- **Fuel log:** real consumption between full tanks, cost per km and monthly spend, and when ethanol pays off in this car. Consumption calibration comes from your own fill-ups.
- **Diagnostics:**
  - readiness monitors and the ECU's own freeze frame (mode 02);
  - a raw diagnostic recorder;
  - a network console that can also tell whether your ELM327 is a clone.
- **Optional AI assistant:** any OpenAI-compatible API (OpenAI, Claude, Gemini…).
  - Explains trouble codes, analyzes trips and answers questions about the car's history.
  - Only aggregated data leaves the phone (no GPS, VIN or places), and the exact text is shown before the first send.
- **Full backup:** a single .zip with the database, settings and imported profiles.
- **Read-only by design:** only mode 01/03/07/0A/09 queries and adapter AT commands. Nothing is written to the ECU.

## Supporting another car

Start from the generic SAE J1979 profile and follow [docs/criar-perfil.md](docs/criar-perfil.md) (Portuguese). Profiles define:
- init commands and polling lanes;
- formulas over response bytes (`A`, `B`…);
- semantic roles;
- fuel model, thermal bands, gear ratios and alerts.

## Building

JDK 17 and the Android SDK (compileSdk 37, targetSdk 36; AGP 9, Kotlin 2.4, Gradle 9):

```bash
./gradlew :app:testDebugUnitTest :app:lintDebug :app:assembleDebug
python3 -I -m unittest discover -s tools/trip-report -p 'test_*.py'
```

CI runs both, plus an emulator smoke test of the R8-optimized build. See [docs/android-auto.md](docs/android-auto.md) for testing on the Desktop Head Unit.

## License

See [LICENSE](LICENSE).
