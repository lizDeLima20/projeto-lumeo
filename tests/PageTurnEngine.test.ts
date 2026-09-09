import assert from"node:assert/strict";import{describe,it}from"node:test";import{PageGeometry}from"../src/reader/page-turn/PageGeometry";import{PageCurlGeometry}from"../src/reader/page-turn/PageCurlGeometry";import{easeProgress}from"../src/reader/page-turn/PageTurnEngine";import{readFileSync}from"node:fs";import{PageShadowRenderer}from"../src/reader/page-turn/PageShadowRenderer";import{PageGestureController}from"../src/reader/page-turn/PageGestureController";import{PageSpreadController}from"../src/reader/page-turn/PageSpreadController";import{PageTurnEngine}from"../src/reader/page-turn/PageTurnEngine";
const element=()=>({clientWidth:400,classList:{add(){},remove(){}},style:{willChange:"",setProperty(){},removeProperty(){}},animate(){return{finished:Promise.resolve()}}})as unknown as HTMLElement;
describe("PageTurnEngine",()=>{it("o dedo percorre mais que a largura da pagina para virar",()=>{const geometry=new PageGeometry(),span=PageGeometry.dragSpanFactor;assert.ok(span>=1.15&&span<=1.5,`span fora da faixa natural: ${span}`);assert.equal(geometry.calculate(0,400,1).progress,0);assert.ok(Math.abs(geometry.calculate(-400,400,1).progress-1/span)<1e-12,"uma largura de arrasto ainda nao termina a virada");assert.equal(geometry.calculate(-400*span,400,1).progress,1);assert.equal(geometry.calculate(-9999,400,1).progress,1);assert.equal(geometry.distanceFor(.5,400),400*span*.5);});it("a folha e um retangulo perfeito, sem dobra nem esmagamento",()=>{const geometry=new PageGeometry();for(const at of [-40,-200,-320,-400]){const step=geometry.calculate(at,400,1);assert.equal(step.skewY,0);assert.equal(step.scaleX,1);assert.equal(step.curlInset,0);assert.equal(step.curlTail,0);assert.equal(step.curlRadius,0);assert.equal(step.translateX,0);}});it("a folha acompanha o dedo linearmente e pousa deitada",()=>{const geometry=new PageGeometry(),L=PageGeometry.landingAngle;for(const at of [.1,.25,.5,.75,1]){const step=geometry.calculate(-geometry.distanceFor(at,400),400,1);assert.ok(Math.abs(step.progress-at)<1e-9,`progresso ${step.progress} != ${at}`);assert.ok(Math.abs(step.angle-(-L*at))<1e-9,"o angulo segue o dedo, sem multiplicador");}assert.ok(L>170);assert.equal(geometry.atProgress(.5,400,-1).angle,L*.5);});it("parou o dedo, parou a folha; voltou o dedo, voltou a folha",()=>{const geometry=new PageGeometry();const a=geometry.calculate(-260,400,1),again=geometry.calculate(-260,400,1),back=geometry.calculate(-130,400,1);assert.deepEqual(a,again,"mesma distancia, mesmo estado - nada anima sozinho");assert.ok(back.progress<a.progress,"voltar o dedo desfaz a virada");assert.ok(Math.abs(back.progress-a.progress/2)<1e-9,"a volta e igualmente proporcional");});it("a folha so se solta perto do fim, e sai sem ser arremessada",()=>{const geometry=new PageGeometry();assert.equal(geometry.atProgress(PageGeometry.releaseAt,400,1).release,0);assert.equal(geometry.atProgress(.5,400,1).flyY,0,"nada de queda antes de perder o apoio");const end=geometry.atProgress(1,400,1);assert.equal(end.release,1);assert.ok(Math.abs(end.flyX)<=PageGeometry.flyPixels&&end.flyY<=PageGeometry.gravityPixels,"saida discreta");assert.ok(end.scale>.95,"a folha nao encolhe de forma visivel");const early=geometry.atProgress(.8,400,1),late=geometry.atProgress(.95,400,1);assert.ok(late.flyY>early.flyY*2,"a gravidade e quadratica: quase nada no comeco da soltura");assert.equal(geometry.atProgress(.5,400,1).tilt,-PageGeometry.tiltDegrees,"a inclinacao segue a curvatura");assert.equal(geometry.atProgress(.5,400,-1).tilt,PageGeometry.tiltDegrees,"e inverte com a direcao");});it("o verso opaco assume exatamente aos 90 graus, e nao ha gradiente na borda direita",()=>{const geometry=new PageGeometry(),shadows=new PageShadowRenderer(),written=new Map<string,string>();const page={style:{setProperty(key:string,value:string){written.set(key,value)},removeProperty(){}}}as unknown as HTMLElement;assert.equal(PageShadowRenderer.hasRightEdgeFoldGradient,false);shadows.render(page,null,geometry.calculate(-400*.2,400,1));assert.equal(written.get("--verso-opacity"),"0");shadows.render(page,null,geometry.calculate(-400*.7,400,1));assert.equal(written.get("--verso-opacity"),"1");});it("velocity é calculada em px/ms",()=>{const gesture=new PageGestureController();gesture.start(300,0);const sample=gesture.update(200,100);assert.equal(sample.velocityX,-1);assert.equal(sample.direction,1)});it("threshold e velocidade decidem complete/return",()=>{const engine=new PageTurnEngine(element(),null,()=>{});assert.equal(engine.shouldComplete(.36,-.1,1),true);assert.equal(engine.shouldComplete(.2,-.8,1),true);assert.equal(engine.shouldComplete(.2,-.1,1),false)});it("animationStateLock impede gesto concorrente",()=>{const engine=new PageTurnEngine(element(),null,()=>{});assert.equal(engine.begin(100,0),true);assert.equal(engine.begin(120,2),false);assert.equal(engine.state,"DRAGGING")});});
describe("PageSpreadController",()=>{it("nextPage previousPage e limites",()=>{const mobile=new PageSpreadController(5,1);assert.equal(mobile.next(1),2);assert.equal(mobile.previous(1),1);assert.equal(mobile.next(5),5);const desktop=new PageSpreadController(10,2);assert.equal(desktop.next(4),6);assert.equal(desktop.previous(4),2)})});

describe("PageCurlGeometry",()=>{
  const curl=new PageCurlGeometry(),L=PageGeometry.landingAngle,W=560;
  it("a folha e plana parada, curva no meio do gesto e plana ao pousar",()=>{
    assert.ok(Math.abs(curl.bendAt(0))<1e-9);assert.ok(Math.abs(curl.bendAt(1))<1e-9);
    assert.ok(curl.bendAt(.5)>25,"tem que curvar no meio");
    const landed=curl.build(1,W,L,1);
    assert.ok(landed.every(strip=>Math.abs(strip.angle-landed[0]!.angle)<1e-9),"pousada, todas as tiras no mesmo angulo");
  });
  it("a ponta acompanha o dedo e a base fica para tras",()=>{
    const mid=curl.build(.5,W,L,1);
    assert.ok(Math.abs(mid[mid.length-1]!.angle)>Math.abs(mid[0]!.angle),"a ponta gira mais que a base");
    assert.ok(Math.abs(Math.abs(mid[mid.length-1]!.angle)-L*.5)<3,"a ponta segue o dedo");
  });
  it("a folha curva nunca desaparece, a placa rigida sim",()=>{
    // a flat plate projects to zero width at 90deg - the middle of the gesture had
    // nothing on screen but the cast shadow, which is what read as a grey roll
    let worstCurl=1,worstFlat=1;
    for(let step=0;step<=200;step+=1){
      const progress=step/200,strips=curl.build(progress,W,L,1);
      const projected=strips.reduce((sum,strip)=>sum+Math.abs(Math.cos(strip.angle*Math.PI/180))*strip.width,0)/W;
      worstCurl=Math.min(worstCurl,projected);
      worstFlat=Math.min(worstFlat,Math.abs(Math.cos(L*progress*Math.PI/180)));
    }
    assert.ok(worstCurl>.1,`folha curva some (${worstCurl})`);
    assert.ok(worstFlat<.01,"a placa rigida some - e por isso que ela foi substituida");
  });
  it("o sombreamento e continuo entre tiras vizinhas",()=>{
    // a single value per strip made every seam a visible step: the banding
    for(const progress of [.15,.35,.5,.7,.9]){
      const strips=curl.build(progress,W,L,1);
      for(let index=0;index+1<strips.length;index+=1){
        assert.ok(Math.abs(strips[index]!.shadeEnd-strips[index+1]!.shadeStart)<1e-9,
          `costura visivel entre as tiras ${index} e ${index+1} em ${progress}`);
      }
    }
  });
  it("a sobra anti-costura cresce quando a tira fica de perfil",()=>{
    const step=W/PageCurlGeometry.strips;
    assert.ok(curl.bleedFor(85,step)>curl.bleedFor(20,step)*3,"de perfil precisa de muito mais sobra");
    assert.ok(curl.bleedFor(89.9,step)<=step*.85,"nunca engole a tira seguinte");
  });
  it("a folha nao pode carregar overflow nem filter - achatam o arco",()=>{
    const css=readFileSync("src/styles/reader.css","utf8");
    const rule=css.slice(css.indexOf(".page-turn-active,"),css.indexOf("}",css.indexOf(".page-turn-active,")));
    assert.ok(rule.includes("overflow:visible"),rule);
    assert.ok(rule.includes("transform-style:preserve-3d"),rule);
    assert.equal(rule.includes("filter:"),false,"filter e propriedade de agrupamento: achataria o 3D");
  });
});

describe("acabamento do folhear",()=>{
  const css=readFileSync("src/styles/reader.css","utf8");
  const leafRule=css.slice(css.indexOf(".page-turn-active,"),css.indexOf("}",css.indexOf(".page-turn-active,")));
  it("a conclusao e lenta o bastante para se ver a folha terminar",()=>{
    const [cLow,cHigh]=PageTurnEngine.completeMs,[rLow,rHigh]=PageTurnEngine.restoreMs;
    assert.ok(cLow>=500&&cHigh<=800,`completar fora da faixa: ${cLow}-${cHigh}`);
    assert.ok(rLow>=350&&rHigh<=600,`voltar fora da faixa: ${rLow}-${rHigh}`);
    assert.ok(cLow>rLow,"completar e mais demorado que voltar");
  });
  it("o easing desacelera no fim, sem ser linear",()=>{
    const curve=PageTurnEngine.settleCurve;
    assert.equal(easeProgress(...curve,0),0);
    assert.ok(Math.abs(easeProgress(...curve,1)-1)<1e-6);
    assert.ok(easeProgress(...curve,.5)>.5,"adianta cedo e desacelera - nao e linear");
    const nearEnd=easeProgress(...curve,1)-easeProgress(...curve,.9);
    const nearStart=easeProgress(...curve,.1)-easeProgress(...curve,0);
    assert.ok(nearEnd<nearStart,"o movimento tem que frear no fim");
  });
  it("a folha reivindica o toque so enquanto vira, e nada a achata",()=>{
    assert.ok(leafRule.includes("touch-action:none"),"durante a virada o gesto e da folha");
    assert.ok(css.includes(".reflow-sheet { position:absolute;inset:0;"),"o repouso mantem pan-y para a rolagem");
    // every one of these is a grouping property: any of them collapses transform-style
    for(const flattener of ["filter:","isolation:","clip-path:","opacity:"]){
      assert.equal(leafRule.includes(flattener),false,`${flattener} na folha achataria o arco 3D`);
    }
    assert.match(css,/\.open-book-page:not\(\.page-turn-active\),\.reflow-sheet:not\(\.page-turn-active\)\{isolation:isolate\}/);
  });
  it("nenhuma faixa preta lateral acompanhando a borda",()=>{
    assert.equal(/box-shadow:[^;}]*-\d{2,}px/.test(css),false,"sombra lateral pesada");
    assert.equal(leafRule.includes("box-shadow"),false);
  });
});
