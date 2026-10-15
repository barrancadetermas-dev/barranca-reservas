import sys, json
from playwright.sync_api import sync_playwright
def measure(vp, label):
    with sync_playwright() as p:
        b=p.chromium.launch(); pg=b.new_context(viewport=vp).new_page()
        pg.goto('http://localhost:5199/_dev/tests/harness/harness.html'); pg.wait_for_function('window.__ready===true')
        pg.evaluate("form.open(); form._goToStep(2)"); pg.wait_for_timeout(600)
        r = pg.evaluate("""()=>{
          const q=s=>document.querySelector(s); const h=e=>e? Math.round(e.getBoundingClientRect().height):0;
          const step=q('#step-2'); let body=step.parentElement; while(body && !['auto','scroll'].includes(getComputedStyle(body).overflowY)) body=body.parentElement; body=body||step.parentElement; const modal=q('#modal-booking');
          const groups=[...step.querySelectorAll('.form-group')].filter(g=>!g.closest('.form-group:not(:scope)')||true).map(g=>[ (g.querySelector('label')?.innerText||'').split('\\n')[0].slice(0,28), h(g)]);
          return { viewportH: innerHeight, modalW: modal? Math.round(modal.getBoundingClientRect().width):null, modalH: h(modal),
                   stepH: h(step), stepScrollH: step.scrollHeight, stepClientH: step.clientHeight, stepOverflow: getComputedStyle(step).overflowY, scrollNeededStep: step.scrollHeight-step.clientHeight, bodyScrollH: body.scrollHeight, bodyClientH: body.clientHeight, scrollNeeded: body.scrollHeight-body.clientHeight, groups }; }""")
        print(label, json.dumps(r, ensure_ascii=False)); b.close(); return r
measure({'width':1280,'height':800}, 'ESCRITORIO 1280x800')
measure({'width':390,'height':844}, 'MÓVIL 390x844')
