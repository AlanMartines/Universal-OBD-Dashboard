# Testar o Android Auto

A tela do Android Auto ([`TelemetryScreen`](../app/src/main/java/com/universal/obddashboard/car/TelemetryScreen.kt)) é uma grade com seis blocos: RPM, velocidade, motor, consumo, bateria e alertas. Ela tem também o botão Iniciar/Parar.

## O que os testes automáticos já garantem

O [`TelemetryScreenTest`](../app/src/test/java/com/universal/obddashboard/car/TelemetryScreenTest.kt) monta a tela com a biblioteca oficial de testes do Android Auto (`androidx.car.app:app-testing`) e confere:
- o modelo de grade é aceito pelas validações da biblioteca;
- os seis títulos são fixos entre atualizações, para que cada atualização não conte como uma tela nova na pilha limitada do Android Auto;
- textos e cores reagem aos valores (rotação acima da faixa vermelha, motor acima da temperatura crítica, tensão).

## Teste manual no computador (Desktop Head Unit)

O Desktop Head Unit (DHU) é o simulador oficial da central do carro e roda no computador:

1. No Android Studio, *SDK Manager → SDK Tools*: instale **Android Auto Desktop Head Unit Emulator**. Ele fica em `<sdk>/extras/google/auto/`.
2. No celular, abra o app **Android Auto**. Em *Configurações*, toque 10 vezes em *Versão* para liberar o modo de desenvolvedor.
3. No menu ⋮ do Android Auto, escolha **Iniciar servidor da unidade principal** (*Start head unit server*).
4. Com o celular ligado por USB e a depuração ativa:
   ```bash
   adb forward tcp:5277 tcp:5277
   cd <sdk>/extras/google/auto && ./desktop-head-unit
   ```
5. No DHU, abra o **Universal OBD Dashboard** pelo inicializador de apps.

O build de debug aceita qualquer host. O de release só aceita os hosts oficiais do Android Auto, listados em [`res/values/car_hosts.xml`](../app/src/main/res/values/car_hosts.xml).

O que conferir:
- **Parado:** "--" nos valores e "Iniciar" no botão.
- **Iniciar:** com o adaptador pareado, a captura começa e os valores aparecem em até ~1 s.
- **Alertas:** temperatura e luz de injeção aparecem no bloco **Alertas**. Os críticos também aparecem como aviso (toast).
- **Parar:** encerra a captura, que é salva no histórico.

## No carro

O app aparece na categoria **IoT** do Android Auto, porque não existe uma categoria de telemetria. Ao conectar o celular à central, a sessão do Android Auto também inicia a captura automaticamente.
