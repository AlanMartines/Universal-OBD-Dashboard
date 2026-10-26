"""Gera a página única de pré-visualização do painel (dash.js + dash.css + sim.js, fontes embutidas).

Uso, na raiz do repositório:
    python3 tools/painel-preview/build.py            # → tools/painel-preview/out/dashboard-preview.html

A página sai sem <!doctype>/<head>/<body> porque é publicada como Artifact do Claude, que
acrescenta esse esqueleto. Para abrir direto no navegador, use --standalone.
"""
import argparse
import base64
import pathlib
import re

HERE = pathlib.Path(__file__).resolve().parent
WEB = HERE.parents[1] / 'app' / 'src' / 'main' / 'assets' / 'web'


def build(standalone: bool, replay: pathlib.Path = None) -> str:
    css = (WEB / 'dash.css').read_text()
    css = re.sub(
        r'url\("fonts/([^"]+\.woff2)"\)',
        lambda m: 'url("data:font/woff2;base64,' + base64.b64encode((WEB / 'fonts' / m.group(1)).read_bytes()).decode() + '")',
        css,
    )
    page = (HERE / 'harness.html').read_text()
    # Trecho de viagem real gerado por tools/trip-report/trip_report.py --replay (opcional; sem GPS nem VIN)
    replay_json = replay.read_text() if replay else ''
    for key, text in (('/*DASH_CSS*/', css), ('/*SIM_JS*/', (WEB / 'sim.js').read_text()), ('/*DASH_JS*/', (WEB / 'dash.js').read_text()),
                      ('/*REPLAY_JSON*/', replay_json)):
        assert page.count(key) == 1, key
        page = page.replace(key, text.replace('</script', '<\\/script'))
    if standalone:
        page = '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">' \
               '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"></head><body>' + page + '</body></html>'
    return page


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('--standalone', action='store_true', help='documento HTML completo, para abrir direto no navegador')
    ap.add_argument('-o', '--out', type=pathlib.Path, default=HERE / 'out' / 'dashboard-preview.html')
    ap.add_argument('--replay', type=pathlib.Path, help='trecho de viagem real (trip_report.py --replay) para a opção "Viagem real"')
    args = ap.parse_args()
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(build(args.standalone, args.replay))
    print(f'{args.out} ({args.out.stat().st_size} bytes)')
