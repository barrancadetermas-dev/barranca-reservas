# Regenera los arneses (_dev/tests/harness/*.html) copiando el HTML REAL de index.html.
# Ejecutar SIEMPRE después de cambiar el HTML del modal/secciones, o las pruebas verán la versión vieja.
import io, re, os
root = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../..'))
s = io.open(os.path.join(root, 'index.html'), encoding='utf-8').read(); L = s.split('\n')
def extract(marker):
    i = next(k for k, l in enumerate(L) if marker in l); depth = 0; out = []
    for k in range(i, len(L)):
        l = L[k]; out.append(l); depth += len(re.findall(r'<div\b', l)) - len(re.findall(r'</div>', l))
        if depth <= 0 and k > i: break
    return '\n'.join(out)
css = re.findall(r'<link rel="stylesheet" href="\./(css/[^"]+)">', s)
tags = ''.join(f'<link rel="stylesheet" href="/{c}">' for c in css)
head = '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' + tags + '</head><body>'
H = os.path.join(root, '_dev/tests/harness')
form = head + '<div id="toast-container"></div>\n' + extract('id="overlay-booking"') + '\n' + extract('id="overlay-detail"') + '\n<script type="module" src="/_dev/tests/harness/harness.js"></script></body></html>'
io.open(os.path.join(H, 'harness.html'), 'w', encoding='utf-8').write(form)
body = s[s.index('<body'):s.index('</body>')]
body = re.sub(r'<script\b.*?</script>', '', body, flags=re.S); body = re.sub(r'<body[^>]*>', '', body, count=1)
for name in ('dash', 'list', 'cal'):
    io.open(os.path.join(H, f'harness-{name}.html'), 'w', encoding='utf-8').write(head + body + '<div id="toast-container"></div><script type="module" src="/_dev/tests/harness/harness-%s.js"></script></body></html>' % name)
print('arneses regenerados con', len(css), 'hojas de estilo')
