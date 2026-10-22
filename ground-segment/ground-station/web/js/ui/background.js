// DUSK background layer: the night sky turning to first light. Self-contained: it
// draws on its own canvas and touches nothing else in the app.
export function startDawnSky(cv) {
if(!cv||!cv.getContext)return;const cx=cv.getContext('2d'),RM=matchMedia('(prefers-reduced-motion: reduce)').matches,PAD=48,TAU=Math.PI*2;
let W,H,dpr,L={},tw=[],px=0,py=0,tx=0,ty=0,shoot=[],nextShoot=0,rz;
const mulberry=a=>()=>{a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296};
const PAL=[[235,240,255],[235,240,255],[235,240,255],[170,205,255],[170,205,255],[196,176,255],[255,228,205]];
function layer(){const c=document.createElement('canvas');c.width=(W+2*PAD)*dpr;c.height=(H+2*PAD)*dpr;const g=c.getContext('2d');g.setTransform(dpr,0,0,dpr,PAD*dpr,PAD*dpr);return{c,g}}
function dot(g,x,y,r,a,k){g.fillStyle=`rgba(${k[0]},${k[1]},${k[2]},${a})`;if(r<.8)g.fillRect(x-r,y-r,2*r,2*r);else{g.beginPath();g.arc(x,y,r,0,TAU);g.fill();if(r>1.15){g.fillStyle=`rgba(${k[0]},${k[1]},${k[2]},${a*.1})`;g.beginPath();g.arc(x,y,r*3.2,0,TAU);g.fill()}}}
const fd=y=>{const t=Math.min(1,Math.max(0,(y/H-.3)/.6));return Math.pow(1-t,1.6)*.85+.02};
function stars(g,list){for(const s of list)dot(g,s.x,s.y,s.r,s.a*fd(s.y),s.k)}
function build(){W=innerWidth;H=innerHeight;dpr=Math.min(devicePixelRatio||1,2);cv.width=W*dpr;cv.height=H*dpr;const R=mulberry(20261019),pick=()=>PAL[(R()*PAL.length)|0];
const area=W*H,total=Math.min(5600,Math.max(1800,area/190|0));
const mk=(n,r0,r1,a0,a1)=>{const o=[];for(let i=0;i<n;i++)o.push({x:-PAD+R()*(W+2*PAD),y:-PAD+R()*(H+2*PAD),r:r0+Math.pow(R(),2)*(r1-r0),a:a0+Math.pow(R(),2.2)*(a1-a0),k:pick()});return o};
const far=mk(total*.58|0,.35,.7,.18,.75),mid=mk(total*.3|0,.5,.95,.25,.85),near=mk(total*.07|0,.8,1.5,.4,1);
const gauss=()=>Math.sqrt(-2*Math.log(R()+1e-9))*Math.cos(TAU*R());
for(let k=0;k<7;k++){const ox=R()*W,oy=R()*H*.75,sg=30+R()*70,n=60+(R()*110|0);for(let i=0;i<n;i++)(R()<.7?far:mid).push({x:ox+gauss()*sg,y:oy+gauss()*sg*.7,r:.35+Math.pow(R(),2)*.7,a:.2+Math.pow(R(),1.6)*.7,k:pick()})}
tw=[];const nt=Math.min(420,total*.08|0);for(let i=0;i<nt;i++){const d=[6,12,20][(R()*3)|0];tw.push({x:-PAD+R()*(W+2*PAD),y:-PAD+R()*(H+2*PAD),r:.5+R()*.8,a:.5+R()*.5,k:pick(),d,ph:R()*TAU,sp:TAU/(5+R()*7)})}
/* base: deep navy, faint nebulae */
const b=layer(),g=b.g,bg=g.createLinearGradient(0,0,0,H);bg.addColorStop(0,'#090f2b');bg.addColorStop(.3,'#0f1842');bg.addColorStop(.55,'#1b2658');bg.addColorStop(.72,'#2c3a6e');bg.addColorStop(.84,'#46507f');bg.addColorStop(.92,'#6a6a92');bg.addColorStop(1,'#7a7494');g.fillStyle=bg;g.fillRect(-PAD,-PAD,W+2*PAD,H+2*PAD);
/* first Fajr light, upper right */
{const M=Math.max(W,H*.7),lt=(x,y,r,sx,sy,st)=>{g.save();g.translate(x,y);g.scale(sx,sy);const q=g.createRadialGradient(0,0,0,0,0,r);st.forEach(e=>q.addColorStop(e[0],e[1]));g.fillStyle=q;g.beginPath();g.arc(0,0,r,0,TAU);g.fill();g.restore()};
lt(W*.96,H*.02,M*.62,1,.85,[[0,'rgba(222,140,96,.26)'],[.25,'rgba(200,128,100,.15)'],[.55,'rgba(150,120,160,.07)'],[1,'rgba(150,120,160,0)']]);
lt(W*.95,H*.0,M*.34,1,.8,[[0,'rgba(240,172,112,.26)'],[.4,'rgba(225,146,96,.12)'],[1,'rgba(225,146,96,0)']]);
lt(W*.97,H*-.02,M*.15,1.2,.8,[[0,'rgba(250,200,150,.22)'],[1,'rgba(250,200,150,0)']])}
const nb=layer(),n2=nb.g,neb=(x,y,r,sy,c)=>{n2.save();n2.translate(x,y);n2.scale(1,sy);const q=n2.createRadialGradient(0,0,0,0,0,r);q.addColorStop(0,`rgba(${c},.09)`);q.addColorStop(.5,`rgba(${c},.04)`);q.addColorStop(1,`rgba(${c},0)`);n2.fillStyle=q;n2.beginPath();n2.arc(0,0,r,0,TAU);n2.fill();n2.restore()};
neb(W*.18,H*.26,W*.42,.6,'84,72,210');neb(W*.82,H*.38,W*.38,.55,'124,84,210');neb(W*.5,H*.66,W*.5,.4,'60,92,200');neb(W*.92,H*.08,W*.3,.6,'100,90,220');
L.base=b;L.neb=nb;
for(const [n,l] of [['far',far],['mid',mid],['near',near]]){const o=layer();stars(o.g,l);L[n]=o}
/* faint orbital arcs */
const ar=layer(),a=ar.g;a.lineWidth=1;a.strokeStyle='rgba(165,139,255,.10)';a.beginPath();a.ellipse(W*.5,H*.58,W*.72,H*.34,-.32,0,TAU);a.stroke();
a.strokeStyle='rgba(92,200,255,.07)';a.setLineDash([2,10]);a.beginPath();a.ellipse(W*.3,H*.36,W*.5,H*.2,.2,0,TAU);a.stroke();L.arc=ar;
/* dawn horizon */
const hy=H*(H>W?.93:.9),Rp=Math.max(W*2.4,900),pcx=W*.58,gx=W*.62,gl=layer(),k=gl.g;
const haze=(sy,r,st)=>{k.save();k.translate(gx,hy);k.scale(1,sy);const q=k.createRadialGradient(0,0,0,0,0,r);st.forEach(e=>q.addColorStop(e[0],e[1]));k.fillStyle=q;k.beginPath();k.arc(0,0,r,0,TAU);k.fill();k.restore()};
haze(.25,W*1.2,[[0,'rgba(190,170,210,.12)'],[1,'rgba(190,170,210,0)']]);haze(.12,W*.9,[[0,'rgba(120,160,255,.14)'],[1,'rgba(120,160,255,0)']]);
haze(.34,W*.75,[[0,'rgba(240,172,112,.20)'],[.3,'rgba(220,142,102,.09)'],[.6,'rgba(150,130,200,.05)'],[1,'rgba(150,130,200,0)']]);
haze(.08,W*.42,[[0,'rgba(250,202,152,.32)'],[.25,'rgba(235,160,110,.13)'],[1,'rgba(235,150,100,0)']]);L.glow=gl;
const f=layer(),h=f.g;
h.strokeStyle='rgba(110,150,255,.10)';h.lineWidth=10;h.beginPath();h.arc(pcx,hy+Rp,Rp+5,0,TAU);h.stroke();h.strokeStyle='rgba(110,150,255,.04)';h.lineWidth=22;h.beginPath();h.arc(pcx,hy+Rp,Rp+11,0,TAU);h.stroke();
const pb=h.createLinearGradient(0,hy,0,hy+H*.2);pb.addColorStop(0,'#1d2552');pb.addColorStop(1,'#0b1030');h.fillStyle=pb;h.beginPath();h.arc(pcx,hy+Rp,Rp,0,TAU);h.fill();
const gf=Math.min(.95,Math.max(.05,gx/W)),rim=h.createLinearGradient(-PAD,0,W+PAD,0);rim.addColorStop(0,'rgba(255,160,90,0)');rim.addColorStop(gf-.3,'rgba(250,190,140,0)');rim.addColorStop(gf,'rgba(250,200,150,.6)');rim.addColorStop(Math.min(1,gf+.3),'rgba(160,120,255,0)');rim.addColorStop(1,'rgba(160,120,255,0)');
h.strokeStyle=rim;h.lineWidth=1.2;h.beginPath();h.arc(pcx,hy+Rp,Rp,0,TAU);h.stroke();h.globalAlpha=.14;h.lineWidth=7;h.stroke();h.globalAlpha=1;L.front=f;L.arcP={rx:W*.72,ry:H*.34,x:W*.5,y:H*.58,rot:-.32}}
const D={neb:4,glow:3,base:4,far:6,mid:12,near:20,arc:9,front:3};
function draw(t){const s=t/1000;cx.setTransform(1,0,0,1,0,0);cx.clearRect(0,0,cv.width,cv.height);cx.setTransform(dpr,0,0,dpr,0,0);
const sc=Math.min(1,(scrollY||0)/1500),ox=d=>-PAD-px*d,oy=d=>-PAD-(py*.6+sc*.4)*d,put=(n)=>cx.drawImage(L[n].c,0,0,L[n].c.width,L[n].c.height,ox(D[n]),oy(D[n]),W+2*PAD,H+2*PAD);
put('base');{cx.globalAlpha=.85+.15*Math.sin(s*.12);cx.drawImage(L.neb.c,0,0,L.neb.c.width,L.neb.c.height,ox(D.neb)+Math.sin(s*.03)*14,oy(D.neb),W+2*PAD,H+2*PAD);cx.globalAlpha=1}put('far');put('mid');put('near');
for(const q of tw){const al=q.a*fd(q.y)*(.55+.45*Math.sin(s*q.sp+q.ph)),x=q.x+ox(q.d)+PAD,y=q.y+oy(q.d)+PAD;dot(cx,x,y,q.r,al,q.k)}
put('arc');const A=L.arcP,u=s*.035,ex=A.rx*Math.cos(u),ey=A.ry*Math.sin(u),sx=A.x+ex*Math.cos(A.rot)-ey*Math.sin(A.rot)+ox(D.arc)+PAD,sy=A.y+ex*Math.sin(A.rot)+ey*Math.cos(A.rot)+oy(D.arc)+PAD;
cx.fillStyle='rgba(92,200,255,.08)';cx.beginPath();cx.arc(sx,sy,5,0,TAU);cx.fill();cx.fillStyle='rgba(180,225,255,.7)';cx.beginPath();cx.arc(sx,sy,1.3,0,TAU);cx.fill();
if(!RM){if(s>nextShoot){const dir=Math.random()<.5?1:-1,ang=(14+Math.random()*20)*Math.PI/180;shoot.push({x:W*(.1+Math.random()*.8),y:H*Math.random()*.35,vx:dir*Math.cos(ang)*900,vy:Math.sin(ang)*900,t0:s,life:.8+Math.random()*.4});nextShoot=s+12+Math.random()*14}
shoot=shoot.filter(m=>s-m.t0<m.life);for(const m of shoot){const k=(s-m.t0)/m.life,x=m.x+m.vx*(s-m.t0),y=m.y+m.vy*(s-m.t0),len=140,n=Math.hypot(m.vx,m.vy),tx2=x-m.vx/n*len,ty2=y-m.vy/n*len,gr=cx.createLinearGradient(tx2,ty2,x,y),al=Math.sin(Math.PI*k)*.5;gr.addColorStop(0,'rgba(190,210,255,0)');gr.addColorStop(1,`rgba(235,242,255,${al})`);cx.strokeStyle=gr;cx.lineWidth=1.2;cx.beginPath();cx.moveTo(tx2,ty2);cx.lineTo(x,y);cx.stroke()}}
cx.globalAlpha=.9+.1*Math.sin(s*.18+1);put('glow');cx.globalAlpha=1;put('front')}
let last=0;function loop(t){requestAnimationFrame(loop);if(t-last<33)return;last=t;px+=(tx-px)*.04;py+=(ty-py)*.04;draw(t)}
build();nextShoot=3;
if(RM){draw(0);addEventListener('resize',()=>{clearTimeout(rz);rz=setTimeout(()=>{build();draw(0)},150)})}
else{addEventListener('pointermove',e=>{tx=e.clientX/W*2-1;ty=e.clientY/H*2-1},{passive:true});addEventListener('resize',()=>{clearTimeout(rz);rz=setTimeout(build,150)});requestAnimationFrame(loop)}
}
