const express=require('express');
const http=require('http');
const {Server}=require('socket.io');
const path=require('path');
const fs=require('fs');
const crypto=require('crypto');
const bcrypt=require('bcryptjs');
const jwt=require('jsonwebtoken');
const Go=require('./public/go');

const PORT=process.env.PORT||3000;
const JWT_SECRET=process.env.JWT_SECRET||'change-this-secret-before-deploy-'+crypto.randomBytes(12).toString('hex');
const DATA_DIR=process.env.DATA_DIR||path.join(__dirname,'data');
const DB_FILE=path.join(DATA_DIR,'users.json');
fs.mkdirSync(DATA_DIR,{recursive:true});
let db={users:[]};
try{if(fs.existsSync(DB_FILE))db=JSON.parse(fs.readFileSync(DB_FILE,'utf8'));}catch(e){console.error('Cannot read users database:',e.message);}
function saveDb(){fs.writeFileSync(DB_FILE,JSON.stringify(db,null,2));}
const app=express();app.use(express.json({limit:'20kb'}));app.use(express.static(path.join(__dirname,'public')));
const server=http.createServer(app);const io=new Server(server,{cors:{origin:true,credentials:true}});
const rooms=new Map();const waiting=[];
const cleanName=s=>String(s||'').trim().replace(/[^\p{L}\p{N}_ -]/gu,'').slice(0,18);
function publicUser(u){return {id:u.id,username:u.username,elo:u.elo,wins:u.wins,losses:u.losses,draws:u.draws,games:u.games};}
function tokenFor(u){return jwt.sign({id:u.id},JWT_SECRET,{expiresIn:'30d'});}
function auth(req,res,next){try{const raw=(req.headers.authorization||'').replace(/^Bearer\s+/i,'');const p=jwt.verify(raw,JWT_SECRET);req.user=db.users.find(x=>x.id===p.id);if(!req.user)return res.status(401).json({error:'Phiên đăng nhập không hợp lệ.'});next();}catch{return res.status(401).json({error:'Bạn cần đăng nhập.'});}}
app.post('/api/register',async(req,res)=>{try{const username=cleanName(req.body.username),password=String(req.body.password||'');if(username.length<3)return res.status(400).json({error:'Tên tài khoản cần ít nhất 3 ký tự.'});if(password.length<6)return res.status(400).json({error:'Mật khẩu cần ít nhất 6 ký tự.'});if(db.users.some(u=>u.username.toLowerCase()===username.toLowerCase()))return res.status(409).json({error:'Tên tài khoản đã tồn tại.'});const u={id:crypto.randomUUID(),username,password:await bcrypt.hash(password,10),elo:1000,wins:0,losses:0,draws:0,games:0,createdAt:Date.now()};db.users.push(u);saveDb();res.json({token:tokenFor(u),user:publicUser(u)});}catch(e){res.status(500).json({error:'Không thể tạo tài khoản.'});}});
app.post('/api/login',async(req,res)=>{const username=String(req.body.username||'').trim(),password=String(req.body.password||'');const u=db.users.find(x=>x.username.toLowerCase()===username.toLowerCase());if(!u||!await bcrypt.compare(password,u.password))return res.status(401).json({error:'Tên tài khoản hoặc mật khẩu không đúng.'});res.json({token:tokenFor(u),user:publicUser(u)});});
app.get('/api/me',auth,(req,res)=>res.json({user:publicUser(req.user)}));
app.get('/api/leaderboard',(req,res)=>res.json(db.users.slice().sort((a,b)=>b.elo-a.elo||b.wins-a.wins).slice(0,50).map((u,i)=>({...publicUser(u),rank:i+1}))));
app.get('/api/health',(req,res)=>res.json({ok:true,rooms:rooms.size,players:io.engine.clientsCount}));
function playerInfo(id){const u=db.users.find(x=>x.id===id);return u?publicUser(u):{id,username:'Khách',elo:1000,wins:0,losses:0,draws:0,games:0};}
function roomState(r){return {code:r.code,game:Go.serialize(r.game),players:{black:r.black?playerInfo(r.black):null,white:r.white?playerInfo(r.white):null},spectators:r.spectators.size,host:r.host};}
function emitRoom(r){io.to(r.code).emit('room_state',roomState(r));}
function roomForSocket(s){return s.data.room?rooms.get(s.data.room):null;}
function finishRated(r){if(r.ratedDone||!r.game.finished||!r.black||!r.white)return;r.ratedDone=true;const a=db.users.find(u=>u.id===r.black),b=db.users.find(u=>u.id===r.white);if(!a||!b)return;const result=r.game.result||{};const score=result.type==='score'?result.winner:result.winner;const expectedA=1/(1+Math.pow(10,(b.elo-a.elo)/400));const actualA=score===1?1:score===2?0:0.5;const delta=Math.round(32*(actualA-expectedA));a.elo=Math.max(100,Math.round(a.elo+delta));b.elo=Math.max(100,Math.round(b.elo-delta));a.games++;b.games++;if(score===1){a.wins++;b.losses++;}else if(score===2){b.wins++;a.losses++;}else{a.draws++;b.draws++;}saveDb();}
function leaveCurrent(s){const r=roomForSocket(s);if(!r)return;r.spectators.delete(s.id);if(r.black===s.data.userId){r.black=null;}if(r.white===s.data.userId){r.white=null;}s.leave(r.code);s.data.room=null;if(!r.black&&!r.white&&!r.spectators.size)rooms.delete(r.code);else emitRoom(r);}
function code(){let x;do{x=crypto.randomBytes(3).toString('hex').toUpperCase();}while(rooms.has(x));return x;}
io.use((socket,next)=>{try{const raw=socket.handshake.auth?.token;if(raw){const p=jwt.verify(raw,JWT_SECRET);const u=db.users.find(x=>x.id===p.id);if(u)socket.data.userId=u.id;}next();}catch{next();}});
io.on('connection',socket=>{
  socket.emit('connected',{authenticated:!!socket.data.userId,user:socket.data.userId?playerInfo(socket.data.userId):null});
  socket.on('create_room',({size=19}={},cb=()=>{})=>{if(!socket.data.userId)return cb({error:'Hãy đăng nhập để tạo phòng.'});leaveCurrent(socket);const c=code();const r={code:c,game:Go.newGame(Number(size)),black:socket.data.userId,white:null,spectators:new Set(),host:socket.data.userId,ratedDone:false};rooms.set(c,r);socket.join(c);socket.data.room=c;cb({ok:true,code:c,color:1});emitRoom(r);});
  socket.on('join_room',({code:raw}={},cb=()=>{})=>{if(!socket.data.userId)return cb({error:'Hãy đăng nhập để chơi online.'});const c=String(raw||'').trim().toUpperCase(),r=rooms.get(c);if(!r)return cb({error:'Không tìm thấy phòng.'});if(r.black===socket.data.userId||r.white===socket.data.userId){const color=r.black===socket.data.userId?1:2;socket.join(c);socket.data.room=c;socket.data.spectator=false;cb({ok:true,code:c,color,rejoined:true});emitRoom(r);return;}if(r.white)return cb({error:'Phòng đã đủ hai người.'});leaveCurrent(socket);r.white=socket.data.userId;socket.join(c);socket.data.room=c;socket.data.spectator=false;cb({ok:true,code:c,color:2});emitRoom(r);});
  socket.on('spectate_room',({code:raw}={},cb=()=>{})=>{const c=String(raw||'').trim().toUpperCase(),r=rooms.get(c);if(!r)return cb({error:'Không tìm thấy phòng.'});leaveCurrent(socket);r.spectators.add(socket.id);socket.join(c);socket.data.room=c;socket.data.spectator=true;cb({ok:true,code:c});emitRoom(r);});
  socket.on('find_match',({size=19}={},cb=()=>{})=>{if(!socket.data.userId)return cb({error:'Hãy đăng nhập để ghép trận.'});leaveCurrent(socket);const idx=waiting.findIndex(w=>w.size===Number(size)&&w.userId!==socket.data.userId&&rooms.has(w.code));if(idx>=0){const w=waiting.splice(idx,1)[0],r=rooms.get(w.code);if(!r||r.white)return cb({error:'Không tìm được đối thủ, hãy thử lại.'});r.white=socket.data.userId;socket.join(r.code);socket.data.room=r.code;cb({ok:true,code:r.code,color:2});emitRoom(r);}else{const c=code(),r={code:c,game:Go.newGame(Number(size)),black:socket.data.userId,white:null,spectators:new Set(),host:socket.data.userId,ratedDone:false};rooms.set(c,r);waiting.push({code:c,userId:socket.data.userId,size:Number(size)});socket.join(c);socket.data.room=c;cb({ok:true,code:c,color:1,waiting:true});emitRoom(r);}});
  socket.on('move',({index}={},cb=()=>{})=>{const r=roomForSocket(socket);if(!r)return cb({error:'Bạn chưa ở trong phòng.'});const color=r.black===socket.data.userId?1:r.white===socket.data.userId?2:0;if(!color)return cb({error:'Khán giả không thể đi quân.'});if(r.game.turn!==color)return cb({error:'Chưa đến lượt của bạn.'});const out=Go.play(r.game,Number(index));if(!out.ok)return cb({error:out.error});r.game=out.game;cb({ok:true});emitRoom(r);});
  socket.on('pass',(_,cb=()=>{})=>{const r=roomForSocket(socket);if(!r)return cb({error:'Bạn chưa ở trong phòng.'});const color=r.black===socket.data.userId?1:r.white===socket.data.userId?2:0;if(!color)return cb({error:'Khán giả không thể bỏ lượt.'});if(r.game.turn!==color)return cb({error:'Chưa đến lượt của bạn.'});const out=Go.pass(r.game);r.game=out.game;if(r.game.finished)finishRated(r);cb({ok:true});emitRoom(r);});
  socket.on('resign',(_,cb=()=>{})=>{const r=roomForSocket(socket);if(!r)return cb({error:'Bạn chưa ở trong phòng.'});const color=r.black===socket.data.userId?1:r.white===socket.data.userId?2:0;if(!color)return cb({error:'Khán giả không thể đầu hàng.'});r.game={...r.game,turn:color};const out=Go.resign(r.game);r.game=out.game;finishRated(r);cb({ok:true});emitRoom(r);});
  socket.on('leave_room',()=>leaveCurrent(socket));
  socket.on('disconnect',()=>{const r=roomForSocket(socket);if(r){r.spectators.delete(socket.id);if(!r.black&&!r.white&&!r.spectators.size)rooms.delete(r.code);else emitRoom(r);} });
});
server.listen(PORT,()=>console.log(`Co Vay Online running on http://localhost:${PORT}`));
