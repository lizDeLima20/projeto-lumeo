import assert from"node:assert/strict";import{describe,it}from"node:test";import{PageGeometry}from"../src/reader/page-turn/PageGeometry";import{PageCurlGeometry}from"../src/reader/page-turn/PageCurlGeometry";import{PageCurl}from"../src/reader/page-turn/PageCurl";import{PageGestureIntent}from"../src/reader/page-turn/PageGestureIntent";import{easeProgress}from"../src/reader/page-turn/PageTurnEngine";import{readFileSync}from"node:fs";import{PageShadowRenderer}from"../src/reader/page-turn/PageShadowRenderer";import{PageGestureController}from"../src/reader/page-turn/PageGestureController";import{PageSpreadController}from"../src/reader/page-turn/PageSpreadController";import{PageTurnEngine}from"../src/reader/page-turn/PageTurnEngine";
const element=()=>({clientWidth:400,classList:{add(){},remove(){}},style:{willChange:"",setProperty(){},removeProperty(){}},animate(){return{finished:Promise.resolve()}}})as unknown as HTMLElement;
describe("PageTurnEngine",()=>{it("o dedo percorre mais que a largura da pagina para virar",()=>{const geometry=new PageGeometry(),span=PageGeometry.dragSpanFactor;assert.ok(span>=1.15&&span<=1.5,`span fora da faixa natural: ${span}`);assert.equal(geometry.calculate(0,400,1).progress,0);assert.ok(Math.abs(geometry.calculate(-400,400,1).progress-1/span)<1e-12,"uma largura de arrasto ainda nao termina a virada");assert.equal(geometry.calculate(-400*span,400,1).progress,1);assert.equal(geometry.calculate(-9999,400,1).progress,1);assert.equal(geometry.distanceFor(.5,400),400*span*.5);});it("a folha e um retangulo perfeito, sem dobra nem esmagamento",()=>{const geometry=new PageGeometry();for(const at of [-40,-200,-320,-400]){const step=geometry.calculate(at,400,1);assert.equal(step.skewY,0);assert.equal(step.scaleX,1);assert.equal(step.curlInset,0);assert.equal(step.curlTail,0);assert.equal(step.curlRadius,0);assert.equal(step.translateX,0);}});it("a folha acompanha o dedo linearmente e pousa deitada",()=>{const geometry=new PageGeometry(),L=PageGeometry.landingAngle;for(const at of [.1,.25,.5,.75,1]){const step=geometry.calculate(-geometry.distanceFor(at,400),400,1);assert.ok(Math.abs(step.progress-at)<1e-9,`progresso ${step.progress} != ${at}`);assert.ok(Math.abs(step.angle-(-L*at))<1e-9,"o angulo segue o dedo, sem multiplicador");}assert.ok(L>170);assert.equal(geometry.atProgress(.5,400,-1).angle,L*.5);});it("parou o dedo, parou a folha; voltou o dedo, voltou a folha",()=>{const geometry=new PageGeometry();const a=geometry.calculate(-260,400,1),again=geometry.calculate(-260,400,1),back=geometry.calculate(-130,400,1);assert.deepEqual(a,again,"mesma distancia, mesmo estado - nada anima sozinho");assert.ok(back.progress<a.progress,"voltar o dedo desfaz a virada");assert.ok(Math.abs(back.progress-a.progress/2)<1e-9,"a volta e igualmente proporcional");});it("a folha inteira nunca translada: so a ponta cai",()=>{const geometry=new PageGeometry();assert.equal(PageGeometry.movesWholeLeaf,false);for(let step=0;step<=20;step+=1){const value=geometry.atProgress(step/20,400,1);assert.equal(value.flyX,0);assert.equal(value.flyY,0);assert.equal(value.tilt,0);assert.equal(value.scale,1);}});it("o verso opaco assume exatamente aos 90 graus, e nao ha gradiente na borda direita",()=>{const geometry=new PageGeometry(),shadows=new PageShadowRenderer(),written=new Map<string,string>();const page={style:{setProperty(key:string,value:string){written.set(key,value)},removeProperty(){}}}as unknown as HTMLElement;assert.equal(PageShadowRenderer.hasRightEdgeFoldGradient,false);shadows.render(page,null,geometry.calculate(-400*.2,400,1));assert.equal(written.get("--verso-opacity"),"0");shadows.render(page,null,geometry.calculate(-400*.7,400,1));assert.equal(written.get("--verso-opacity"),"1");});it("velocity é calculada em px/ms",()=>{const gesture=new PageGestureController();gesture.start(300,0);const sample=gesture.update(200,100);assert.equal(sample.velocityX,-1);assert.equal(sample.direction,1)});it("threshold e velocidade decidem complete/return",()=>{const engine=new PageTurnEngine(element(),null,()=>{});assert.equal(engine.shouldComplete(.36,-.1,1),true);assert.equal(engine.shouldComplete(.2,-.8,1),true);assert.equal(engine.shouldComplete(.2,-.1,1),false)});it("animationStateLock impede gesto concorrente",()=>{const engine=new PageTurnEngine(element(),null,()=>{});assert.equal(engine.begin(100,0),true);assert.equal(engine.begin(120,2),false);assert.equal(engine.state,"DRAGGING")});});
describe("PageSpreadController",()=>{it("nextPage previousPage e limites",()=>{const mobile=new PageSpreadController(5,1);assert.equal(mobile.next(1),2);assert.equal(mobile.previous(1),1);assert.equal(mobile.next(5),5);const desktop=new PageSpreadController(10,2);assert.equal(desktop.next(4),6);assert.equal(desktop.previous(4),2)})});

describe("PageCurlGeometry",()=>{
  const curl=new PageCurlGeometry(),L=PageGeometry.landingAngle,W=560;
  it("a folha e plana parada, dobra no meio do gesto e pousa plana",()=>{
    assert.ok(curl.build(0,W,L,1).every(strip=>strip.angle===0),"parada, nenhuma tira gira");
    const mid=curl.build(.5,W,L,1),spread=Math.abs(mid[mid.length-1]!.angle)-Math.abs(mid[0]!.angle);
    assert.ok(spread>150,`no meio a folha tem que estar realmente dobrada (${spread.toFixed(0)}deg entre base e ponta)`);
    const landed=curl.build(1,W,L,1);
    assert.ok(landed.every(strip=>Math.abs(strip.angle+L)<1e-6),"pousada, todas as tiras deitadas do outro lado");
  });

  it("a ponta vira primeiro e o papel virado acompanha o dedo",()=>{
    for(const progress of [.1,.25,.5,.75,.9]){
      const strips=curl.build(progress,W,L,1);
      for(let index=1;index<strips.length;index+=1)assert.ok(Math.abs(strips[index]!.angle)>=Math.abs(strips[index-1]!.angle)-1e-9,"quanto mais perto da ponta, mais virada");
      const turned=strips.reduce((sum,strip)=>sum+strip.turned,0)/strips.length;
      assert.ok(Math.abs(turned-progress)<.03,`arrastou ${progress}, virou ${turned.toFixed(3)} da folha`);
    }
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
    // nao pode zerar: a placa rigida some e deixa o meio do gesto em branco. Mas tambem
    // nao pode ficar larga, ou vira uma coluna de texto em pe ao lado da lombada.
    assert.ok(worstCurl>.02,`folha curva some (${worstCurl})`);
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
    assert.ok(curl.bleedFor(85,step)>curl.bleedFor(20,step)*2,"de perfil precisa de muito mais sobra");
    assert.ok(curl.bleedFor(89.9,step)<=step*.85,"nunca engole a tira seguinte");
  });
  it("o renderer do folhear nao usa mais tiras visiveis",()=>{
    const source=readFileSync("src/reader/page-turn/PageCurl.ts","utf8");
    assert.match(source,/page-turn-surface/);
    assert.equal(source.includes("page-turn-strip"),false,"segmentos visiveis voltariam a mostrar costuras");
    assert.match(source,/surface\.append\(front,back\)/,"frente e verso ficam na mesma folha fisica");
  });
  it("a folha curva nao revela faixas retangulares individuais",()=>{
    const css=readFileSync("src/styles/reader.css","utf8");
    assert.equal(css.includes(".page-turn-strip"),false,"CSS segmentado nao pode participar do folhear");
    assert.match(css,/\.page-turn-surface::before\{[^}]*linear-gradient/,"a sombra principal e continua na folha");
    assert.match(css,/\.page-turn-surface__front,\.page-turn-surface__back\{[^}]*background:var\(--reader-paper-lit\)/,"faces continuam opacas");
  });
  it("a folha nao pode carregar overflow nem filter - achatam o arco",()=>{
    const css=readFileSync("src/styles/reader.css","utf8");
    const rule=css.slice(css.indexOf(".page-turn-active,"),css.indexOf("}",css.indexOf(".page-turn-active,")));
    assert.ok(rule.includes("overflow:visible"),rule);
    assert.ok(rule.includes("transform-style:preserve-3d"),rule);
    assert.equal(rule.includes("filter:"),false,"filter e propriedade de agrupamento: achataria o 3D");
  });
  it("a folha tem frente e verso físicos, nunca faces alternadas por display",()=>{
    const css=readFileSync("src/styles/reader.css","utf8"),source=readFileSync("src/reader/page-turn/PageCurl.ts","utf8");
    assert.match(css,/\.page-turn-surface__back\{transform:rotateY\(180deg\)\}/);
    assert.match(css,/backface-visibility:hidden/);
    assert.equal(source.includes("visibility:hidden"),false,"a face nao deve sumir por troca manual durante a virada");
    assert.equal(source.includes("dataset.face"),false);
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

describe("a folha gira em torno da lombada, o livro nao se move",()=>{
  const curl=new PageCurlGeometry(),geo=new PageGeometry(),L=PageGeometry.landingAngle,W=560;
  it("o eixo de encadernacao e fixo em todo o gesto",()=>{
    for(let step=0;step<=100;step+=1){
      const progress=step/100;
      // a dobradica e a borda esquerda da primeira tira: nunca sai do lugar
      assert.equal(curl.build(progress,W,L,1)[0]!.x,0,`a lombada andou em ${progress}`);
      assert.equal(curl.build(progress,W,L,-1)[0]!.x,0);
      // e nada transporta a pagina inteira pelo viewport durante o gesto
      assert.equal(geo.atProgress(progress,W,1).translateX,0);
      if(progress<=PageGeometry.releaseAt)assert.equal(Math.abs(geo.atProgress(progress,W,1).flyX),0);
    }
  });
  it("o que fica em pe e so a crista da dobra, nunca uma coluna de texto",()=>{
    for(let step=0;step<=40;step+=1){
      const strips=curl.build(step/40,W,L,1);
      const standing=strips.filter(strip=>Math.abs(Math.abs(strip.angle)-90)<25).length/strips.length;
      assert.ok(standing<=.2,`${(standing*100).toFixed(0)}% da folha em pe em ${step/40}`);
    }
  });

});

describe("toque no celular e virar para tras",()=>{
  it("um flick que solta no mesmo ponto do ultimo movimento ainda tem velocidade",()=>{
    const gesture=new PageGestureController();gesture.start(360,0);
    for(let t=10;t<=90;t+=10)gesture.update(360-t*1.2,t);
    const release=gesture.finish(360-90*1.2,96);
    assert.ok(release.velocityX<-.9,`soltou a ${release.velocityX.toFixed(2)}px/ms - o flick morria em zero`);
    const engine=new PageTurnEngine(element(),null,()=>{});
    assert.equal(engine.shouldComplete(.08,release.velocityX,1),true,"um flick comum completa a virada");
  });
  it("um dedo que parou antes de soltar nao dispara a virada",()=>{
    const gesture=new PageGestureController();gesture.start(360,0);
    for(let t=10;t<=90;t+=10)gesture.update(360-t,t);
    assert.equal(gesture.finish(270,400).velocityX,0);
  });
  it("no celular uma passada pela tela completa a virada",()=>{
    const phone=new PageGeometry(PageGeometry.singlePageSpanFactor);
    assert.ok(PageGeometry.singlePageSpanFactor<1,"o span do celular nao pode exigir mais que a tela");
    assert.equal(phone.progressFor(412*.9,412),1);
    assert.ok(new PageGeometry().progressFor(412*.9,412)<.8,"o spread continua pedindo um arrasto mais longo");
  });
  it("o toque vira a pagina mesmo comecando sobre o texto; o mouse sobre o texto seleciona",()=>{
    class FakeElement{public constructor(private readonly matches:string[]){}public closest(selector:string){return selector.split(",").some(part=>this.matches.includes(part.trim()))?this:null;}}
    const scope=globalThis as unknown as {Element?:unknown};const previous=scope.Element;scope.Element=FakeElement;
    try{
      const text=new FakeElement(["[data-block-id]"])as unknown as EventTarget,link=new FakeElement(["a"])as unknown as EventTarget;
      assert.equal(PageGestureIntent.startsTurn({button:0,pointerType:"touch",target:text}),true,"no celular o texto e a propria pagina");
      assert.equal(PageGestureIntent.startsTurn({button:0,pointerType:"mouse",target:text}),false);
      assert.equal(PageGestureIntent.startsTurn({button:0,pointerType:"touch",target:link}),false,"controles continuam clicaveis");
      assert.equal(PageGestureIntent.startsTurn({button:2,pointerType:"mouse",target:null}),false);
    }finally{scope.Element=previous;}
  });
  it("virando para tras a dobradica e a borda direita, nunca a externa",()=>{
    const source=readFileSync("src/reader/page-turn/PageCurl.ts","utf8");
    assert.match(source,/direction===1\?"0 50%":"100% 50%"/);
    assert.match(source,/surface\.transformOrigin=origin/);
    assert.match(source,/rotateY\(\$\{angle\.toFixed\(3\)\}deg\)/);
  });
});

describe("a crista da dobra le como papel, nao como texto espremido",()=>{
  const curl=new PageCurlGeometry(),L=PageGeometry.landingAngle;
  it("de frente o texto e legivel; de raspao a tinta some, mas o papel continua opaco",()=>{
    assert.equal(curl.inkAt(0),1);assert.equal(curl.inkAt(-178),1,"o verso deitado tambem se le");
    assert.ok(curl.inkAt(-88)<.05,"de perfil nao sobra texto para parecer duplicado");
    for(let angle=0;angle<=178;angle+=2){const ink=curl.inkAt(-angle);assert.ok(ink>=0&&ink<=1);}
    const css=readFileSync("src/styles/reader.css","utf8");
    assert.match(css,/\.page-turn-surface__front,\.page-turn-surface__back\{[^}]*opacity:1/,"faces fisicas nunca ficam transparentes");
    assert.match(css,/\.page-turn-surface__front,\.page-turn-surface__back\{[^}]*background:var\(--reader-paper-lit\)/,"o papel da folha e opaco");
  });
  it("em qualquer ponto do gesto, texto legivel so onde a folha esta de frente",()=>{
    for(let step=0;step<=20;step+=1){
      for(const strip of curl.build(step/20,560,L,1)){
        if(Math.abs(Math.cos(strip.angle*Math.PI/180))<PageCurlGeometry.inkFadeFrom)assert.equal(strip.ink,0);
      }
    }
  });
});

describe("velocidade do flick sob quadros lentos",()=>{
  it("uma pausa no comeco do gesto nao dilui a velocidade da soltura",()=>{
    // o dedo encosta, hesita 150ms e dispara 60px em 60ms. Guardando a amostra de antes
    // da janela, a leitura se esticava ate o toque inicial: 0.29px/ms, abaixo do flick,
    // e a pagina voltava. So as amostras de dentro da janela contam.
    const gesture=new PageGestureController();gesture.start(316,0);
    for(const [x,t] of [[312,150],[292,170],[272,190],[252,210]])gesture.update(x,t);
    const release=gesture.finish(252,220);
    assert.ok(release.velocityX<=-PageTurnEngine.flickVelocity,`soltou a ${release.velocityX.toFixed(3)}px/ms`);
    const stretched=(252-316)/220;
    assert.ok(stretched>-PageTurnEngine.flickVelocity,"o calculo antigo teria perdido este flick");
  });
  it("uma cauda realmente lenta continua nao virando",()=>{
    const gesture=new PageGestureController();gesture.start(330,887);
    for(const [x,t] of [[316,887],[302,909],[288,1030],[274,1074],[260,1107]])gesture.update(x,t);
    const release=gesture.finish(260,1129);
    assert.ok(Math.abs(release.velocityX-(260-288)/(1129-1030))<1e-9,"mede a cauda real: 28px em 99ms");
    assert.ok(release.velocityX>-PageTurnEngine.flickVelocity);
  });

});
