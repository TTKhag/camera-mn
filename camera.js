'use strict';
// Giám sát camera – chạy hoàn toàn trên trình duyệt (GitHub Pages).
const KEY='camdash.v1', HLS_URL='https://cdnjs.cloudflare.com/ajax/libs/hls.js/1.5.13/hls.min.js';
const S={cams:[],cfg:{retry:5},devs:[],run:new Map(),pw:{},editId:null};
const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
const esc=t=>String(t??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const el=(t,p={})=>Object.assign(document.createElement(t),p);
const TYPES={usb:'Webcam / USB',mjpeg:'IP – MJPEG',hls:'IP – HLS',webrtc:'IP – WebRTC (WHEP)'};
const LBL={idle:'Đã dừng',connecting:'Đang kết nối…',live:'Đang phát',error:'Lỗi – đang thử lại'};
const HINT={mjpeg:'Ví dụ: https://camera.example/video.mjpg. MJPEG không gửi được mật khẩu qua trình duyệt; camera cần cho phép truy cập hoặc dùng máy chủ trung gian.',
 hls:'Ví dụ: https://máy-chủ/cam1/index.m3u8. Máy chủ phải bật CORS.',
 webrtc:'Ví dụ: https://máy-chủ:8889/cam1/whep (go2rtc, MediaMTX). Máy chủ phải bật CORS.'};
const ERR={NotAllowedError:'Bạn đã chặn quyền camera. Hãy bấm biểu tượng ổ khóa trên thanh địa chỉ để cho phép.',
 NotFoundError:'Không tìm thấy camera nào.',NotReadableError:'Camera đang được ứng dụng khác sử dụng hoặc bị lỗi.',
 OverconstrainedError:'Camera đã chọn không còn khả dụng.',SecurityError:'Trình duyệt chặn camera (cần HTTPS).',
 TypeError:'Không thể kết nối: sai địa chỉ, máy chủ chưa bật CORS hoặc bị chặn nội dung hỗn hợp (HTTP trên trang HTTPS).'};
const msg=e=>ERR[e.name]||e.message||'Lỗi không xác định.';
let tt;function toast(t){const e=$('#toast');e.textContent=t;e.style.display='block';clearTimeout(tt);tt=setTimeout(()=>e.style.display='none',4000)}

function load(){try{const d=JSON.parse(localStorage.getItem(KEY));if(d){S.cams=d.cams||[];S.cfg={...S.cfg,...d.cfg}}}catch{}}
function save(){try{localStorage.setItem(KEY,JSON.stringify({cams:S.cams.map(({id,name,type,deviceId,url,user})=>({id,name,type,deviceId,url,user})),cfg:S.cfg}))}catch{toast('Không lưu được dữ liệu trên trình duyệt này.')}}

function parseUrl(raw){
  let u;try{u=new URL(raw)}catch{throw new Error('Địa chỉ không hợp lệ.')}
  if(/^rtsps?:$/.test(u.protocol))throw new Error('RTSP không phát được trực tiếp trên trình duyệt. Hãy chuyển sang HLS hoặc WebRTC bằng go2rtc/MediaMTX.');
  if(!/^https?:$/.test(u.protocol))throw new Error('Chỉ hỗ trợ địa chỉ http hoặc https.');
  if(u.username||u.password)throw new Error('Không nhập tài khoản/mật khẩu trong địa chỉ. Hãy dùng ô riêng bên dưới.');
  if(location.protocol==='https:'&&u.protocol==='http:'&&!['localhost','127.0.0.1'].includes(u.hostname))
    throw new Error('Trang HTTPS không được tải luồng HTTP (nội dung hỗn hợp). Hãy dùng địa chỉ HTTPS.');
  return u;
}
const auth=(c,pw)=>'Basic '+btoa(unescape(encodeURIComponent((c.user||'')+':'+pw)));
const timeout=(ms,t)=>new Promise((_,no)=>setTimeout(()=>no(new Error(t)),ms));
let hlsP;const loadHls=()=>hlsP||(hlsP=new Promise((ok,no)=>{document.head.append(el('script',{src:HLS_URL,onload:ok,onerror:()=>{hlsP=null;no(new Error('Không tải được thư viện HLS.'))}}))}));

// ---- Phát video ----
async function open(r){
  const c=r.cam,box=r.box;box.querySelectorAll('video,img,.ph').forEach(n=>n.remove());
  const mkv=()=>{const v=el('video',{autoplay:true,muted:true,playsInline:true});box.prepend(v);return v};
  if(c.type==='usb'){
    if(!navigator.mediaDevices?.getUserMedia)throw new Error('Trình duyệt không hỗ trợ camera hoặc trang chưa chạy HTTPS.');
    const st=await navigator.mediaDevices.getUserMedia({video:c.deviceId?{deviceId:{exact:c.deviceId}}:true,audio:false});
    const v=mkv();v.srcObject=st;
    r.clean=()=>{st.getTracks().forEach(t=>t.stop());v.srcObject=null;v.remove()};
    st.getVideoTracks()[0].onended=()=>r.fail(new Error('Camera đã bị ngắt kết nối.'));
    await v.play().catch(()=>{});return;
  }
  const u=parseUrl(c.url),pw=S.pw[c.id];
  if(c.type==='mjpeg'){
    const img=el('img',{alt:c.name,referrerPolicy:'no-referrer'});box.prepend(img);
    r.clean=()=>{img.onerror=img.onload=null;img.removeAttribute('src');img.remove()};
    await Promise.race([new Promise((ok,no)=>{img.onload=ok;img.onerror=()=>no(new Error('Không tải được luồng MJPEG. Kiểm tra địa chỉ và mạng.'));img.src=u.href}),timeout(10000,'Hết thời gian chờ luồng MJPEG.')]);
    img.onerror=()=>r.fail(new Error('Luồng MJPEG bị ngắt.'));return;
  }
  if(c.type==='hls'){
    const v=mkv();let h;const native=v.canPlayType('application/vnd.apple.mpegurl');
    r.clean=()=>{h&&h.destroy();v.removeAttribute('src');v.load();v.remove()};
    if(!native)await loadHls();
    if(native){v.src=u.href;v.onerror=()=>r.fail(new Error('Lỗi phát luồng HLS.'))}
    else if(window.Hls?.isSupported()){
      h=new Hls({xhrSetup:x=>{if(pw)x.setRequestHeader('Authorization',auth(c,pw))}});
      h.on(Hls.Events.ERROR,(_,d)=>d.fatal&&r.fail(new Error('Lỗi luồng HLS: '+d.details)));
      h.loadSource(u.href);h.attachMedia(v);
    }else throw new Error('Trình duyệt không hỗ trợ HLS.');
    v.play().catch(()=>{});
    await Promise.race([new Promise(ok=>v.addEventListener('playing',ok,{once:true})),timeout(15000,'Hết thời gian chờ luồng HLS.')]);return;
  }
  if(c.type==='webrtc'){
    const v=mkv(),pc=new RTCPeerConnection();
    r.clean=()=>{pc.onconnectionstatechange=null;pc.close();v.srcObject=null;v.remove()};
    pc.addTransceiver('video',{direction:'recvonly'});
    pc.ontrack=e=>{v.srcObject=e.streams[0]||new MediaStream([e.track])};
    pc.onconnectionstatechange=()=>{if(['failed','disconnected','closed'].includes(pc.connectionState))r.fail(new Error('Kết nối WebRTC bị ngắt.'))};
    await pc.setLocalDescription(await pc.createOffer());
    await Promise.race([new Promise(ok=>{pc.onicegatheringstatechange=()=>pc.iceGatheringState==='complete'&&ok()}),new Promise(ok=>setTimeout(ok,2500))]);
    const hd={'Content-Type':'application/sdp'};if(pw)hd.Authorization=auth(c,pw);
    const res=await fetch(u.href,{method:'POST',headers:hd,body:pc.localDescription.sdp});
    if(!res.ok)throw new Error('Máy chủ WHEP trả về lỗi '+res.status+(res.status===401?' (sai tài khoản hoặc mật khẩu).':'.'));
    await pc.setRemoteDescription({type:'answer',sdp:await res.text()});
    await Promise.race([new Promise(ok=>{v.onplaying=ok}),timeout(15000,'Kết nối được nhưng không nhận được hình ảnh.')]);return;
  }
  throw new Error('Loại camera không được hỗ trợ.');
}
function setSt(r,s,m=''){
  r.status=s;
  $$(`[data-st="${r.cam.id}"]`).forEach(b=>{b.className='badge '+s;b.textContent=LBL[s]});
  const mm=r.box.querySelector('.msg');if(mm)mm.textContent=s==='error'?m:'';
  if(r.cam.id==='test')$('#test-msg').textContent=s==='live'?'Kết nối thành công, đã nhận hình ảnh.':s==='error'?m:'';
  if(r.cam.id==='prev'&&s==='error')toast(m);
  renderStats();
}
async function attempt(r){
  r.clean();r.clean=()=>{};setSt(r,'connecting');
  try{await Promise.race([open(r),new Promise((_,no)=>r.rej=no)]);setSt(r,'live')}
  catch(e){r.clean();r.clean=()=>{};setSt(r,'error',msg(e));if(!r.once&&e.name!=='NotAllowedError')retry(r)}
  finally{r.rej=null}
}
function retry(r){if(!r.want)return;clearTimeout(r.t);r.t=setTimeout(()=>r.want&&attempt(r),S.cfg.retry*1000)}
function start(cam,box,once=false){
  stop(cam.id);
  const r={cam,box,once,want:true,clean(){},status:'idle'};
  r.fail=e=>{if(r.rej)return r.rej(e);if(!r.want)return;r.clean();r.clean=()=>{};setSt(r,'error',msg(e));if(!r.once)retry(r)};
  S.run.set(cam.id,r);attempt(r);
}
function stop(id){const r=S.run.get(id);if(!r)return;r.want=false;clearTimeout(r.t);r.clean();r.clean=()=>{};S.run.delete(id);setSt(r,'idle')}

// ---- Thiết bị webcam ----
async function refreshDevices(){
  try{S.devs=navigator.mediaDevices?.enumerateDevices?(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='videoinput'):[]}catch{S.devs=[]}
  renderDevices();renderStats();
}
async function scan(){
  if(!navigator.mediaDevices?.getUserMedia)return toast('Trình duyệt không hỗ trợ camera hoặc trang chưa chạy HTTPS.');
  try{const st=await navigator.mediaDevices.getUserMedia({video:true,audio:false});st.getTracks().forEach(t=>t.stop())}
  catch(e){toast(msg(e))}
  await refreshDevices();
  toast(S.devs.length?`Tìm thấy ${S.devs.length} webcam.`:'Không tìm thấy webcam nào.');
}
const devName=(d,i)=>d.label||`Camera ${i+1} (chưa cấp quyền)`;
function renderDevices(){
  $('#devs').innerHTML=S.devs.length?S.devs.map((d,i)=>`<div class="item"><div>${esc(devName(d,i))}</div><div class="row">
   <button data-act="prev" data-i="${i}">Xem thử</button><button data-act="adddev" data-i="${i}">Thêm vào danh sách</button></div></div>`).join(''):'<p>Chưa có thiết bị. Bấm “Cấp quyền và dò webcam”.</p>';
}

// ---- Giao diện ----
function renderStats(){
  $('#s-total').textContent=S.cams.length;$('#s-dev').textContent=S.devs.length;
  $('#s-live').textContent=[...S.run.values()].filter(r=>r.status==='live'&&r.cam.id!=='prev'&&r.cam.id!=='test').length;
}
function renderCams(){
  $('#cam-list').innerHTML=S.cams.length?S.cams.map(c=>`<div class="item"><div><b>${esc(c.name)}</b> <span class="badge ${S.run.get(c.id)?.status||'idle'}" data-st="${c.id}">${LBL[S.run.get(c.id)?.status||'idle']}</span>
   <small>${TYPES[c.type]}${c.url?' · '+esc(c.url):''}</small></div><div class="row" data-id="${c.id}">
   <button data-act="watch">Xem trực tiếp</button><button data-act="edit">Sửa</button><button data-act="del" class="danger">Xóa</button></div></div>`).join(''):'<p>Chưa có camera nào. Hãy thêm ở mục “Dò tìm camera”.</p>';
  $('#live-filter').innerHTML='<option value="all">Tất cả camera</option>'+S.cams.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('');
  renderLive();renderStats();
}
function renderLive(){
  const f=$('#live-filter').value||'all';
  $('#grid').innerHTML=S.cams.length?S.cams.map(c=>`<div class="panel" data-id="${c.id}" ${f!=='all'&&f!==c.id?'hidden':''}>
   <div class="box"><p class="ph">Bấm “Bắt đầu” để xem</p><div class="msg"></div></div>
   <div class="row"><b>${esc(c.name)}</b><span class="badge idle" data-st="${c.id}">${LBL.idle}</span></div>
   <div class="row"><button data-act="start">Bắt đầu</button><button data-act="stop">Dừng</button><button data-act="full">Toàn màn hình</button></div></div>`).join(''):'<p>Chưa có camera để giám sát.</p>';
}
function openForm(c={}){
  S.editId=c.id||null;$('#dlg-title').textContent=c.id?'Sửa camera':'Thêm camera';
  $('#f-name').value=c.name||'';$('#f-type').value=c.type||'mjpeg';$('#f-url').value=c.url||'';$('#f-user').value=c.user||'';$('#f-pw').value='';
  $('#f-dev').innerHTML=S.devs.map((d,i)=>`<option value="${esc(d.deviceId)}">${esc(devName(d,i))}</option>`).join('')||'<option value="">Mặc định (hãy dò webcam trước)</option>';
  if(c.deviceId)$('#f-dev').value=c.deviceId;
  $('#test-msg').textContent='';formType();$('#dlg').showModal();
}
function formType(){const u=$('#f-type').value==='usb';$$('.g-usb').forEach(e=>e.hidden=!u);$$('.g-ip').forEach(e=>e.hidden=u);$('#f-hint').textContent=HINT[$('#f-type').value]||''}
function formCam(id){
  const type=$('#f-type').value,c={id,name:$('#f-name').value.trim()||'Camera',type};
  if(type==='usb')c.deviceId=$('#f-dev').value;else{c.url=$('#f-url').value.trim();c.user=$('#f-user').value.trim();parseUrl(c.url)}
  return c;
}
function closeForm(){stop('test');$('#dlg').close()}

function bind(){
  $('#nav').onclick=e=>{const t=e.target.dataset.tab;if(!t)return;$$('#nav button').forEach(b=>b.classList.toggle('on',b===e.target));$$('.tab').forEach(s=>s.classList.toggle('on',s.id==='tab-'+t))};
  document.addEventListener('click',e=>{
    const b=e.target.closest('[data-act]');if(!b)return;const a=b.dataset.act,id=b.closest('[data-id]')?.dataset.id,c=S.cams.find(x=>x.id===id);
    if(a==='add')openForm({type:'mjpeg'});
    if(a==='prev'){const d=S.devs[b.dataset.i];start({id:'prev',name:'Xem thử',type:'usb',deviceId:d.deviceId},$('#prev-box'),true)}
    if(a==='adddev'){const d=S.devs[b.dataset.i];openForm({type:'usb',deviceId:d.deviceId,name:devName(d,+b.dataset.i)})}
    if(a==='edit'&&c)openForm(c);
    if(a==='del'&&c&&confirm(`Xóa camera “${c.name}”?`)){stop(c.id);delete S.pw[c.id];S.cams=S.cams.filter(x=>x!==c);save();renderCams()}
    if(a==='watch'&&c){$('#nav [data-tab=live]').click();$('#live-filter').value=c.id;renderLive();start(c,$(`.panel[data-id="${c.id}"] .box`))}
    if(a==='start'&&c)start(c,b.closest('.panel').querySelector('.box'));
    if(a==='stop')stop(id);
    if(a==='full'){const bx=b.closest('.panel').querySelector('.box');(bx.requestFullscreen?.()||Promise.reject()).catch(()=>toast('Trình duyệt không cho phép toàn màn hình.'))}
  });
  $('#btn-scan').onclick=scan;$('#btn-prev-stop').onclick=()=>stop('prev');
  $('#live-filter').onchange=()=>{const f=$('#live-filter').value;$$('.panel').forEach(p=>p.hidden=f!=='all'&&p.dataset.id!==f)};
  $('#btn-all-start').onclick=()=>$$('.panel:not([hidden])').forEach(p=>start(S.cams.find(c=>c.id===p.dataset.id),p.querySelector('.box')));
  $('#btn-all-stop').onclick=()=>S.cams.forEach(c=>stop(c.id));
  $('#f-type').onchange=formType;$('#btn-cancel').onclick=closeForm;$('#dlg').addEventListener('cancel',()=>stop('test'));
  $('#btn-test').onclick=()=>{try{const c=formCam('test');S.pw.test=$('#f-pw').value;start(c,$('#test-box'),true)}catch(e){$('#test-msg').textContent=msg(e)}};
  $('#frm').onsubmit=e=>{
    e.preventDefault();let c;try{c=formCam(S.editId||'c'+Date.now().toString(36))}catch(x){return toast(msg(x))}
    stop('test');stop(c.id);const pw=$('#f-pw').value;if(pw)S.pw[c.id]=pw;
    const i=S.cams.findIndex(x=>x.id===c.id);i>=0?S.cams[i]=c:S.cams.push(c);save();renderCams();$('#dlg').close();toast('Đã lưu camera.');
  };
  $('#cfg-retry').onchange=e=>{S.cfg.retry=Math.min(120,Math.max(2,+e.target.value||5));e.target.value=S.cfg.retry;save()};
  $('#btn-clear').onclick=()=>{if(!confirm('Xóa toàn bộ camera và cài đặt đã lưu?'))return;S.cams.forEach(c=>stop(c.id));S.cams=[];S.pw={};try{localStorage.removeItem(KEY)}catch{}renderCams();toast('Đã xóa dữ liệu.')};
  navigator.mediaDevices?.addEventListener?.('devicechange',async()=>{const n=S.devs.length;await refreshDevices();
    toast(S.devs.length>n?'Đã phát hiện camera mới được cắm vào.':S.devs.length<n?'Một camera đã bị rút ra.':'Danh sách camera đã thay đổi.')});
  addEventListener('pagehide',()=>[...S.run.keys()].forEach(stop));
}
load();bind();$('#cfg-retry').value=S.cfg.retry;renderCams();refreshDevices();
