/* Shared Go rules engine: CommonJS on server, global GoRules in browser. */
(function(root){
  const BLACK=1, WHITE=2;
  const other=c=>c===BLACK?WHITE:BLACK;
  const keyOf=(board,turn)=>board.join('')+':'+turn;
  function newGame(size=19, komi=6.5){
    if(![9,13,19].includes(Number(size))) throw new Error('Kích thước bàn cờ không hợp lệ.');
    const board=Array(size*size).fill(0);
    return {size:Number(size),board,turn:BLACK,captures:{1:0,2:0},passes:0,moveNumber:0,history:[keyOf(board,BLACK)],moves:[],finished:false,result:null,komi:Number(komi)};
  }
  const neighbors=(i,n)=>{const x=i%n,y=Math.floor(i/n),a=[];if(x>0)a.push(i-1);if(x<n-1)a.push(i+1);if(y>0)a.push(i-n);if(y<n-1)a.push(i+n);return a;};
  function groupAt(board,size,start){
    const color=board[start]; if(!color)return {stones:[],liberties:new Set()};
    const seen=new Set([start]), stones=[], liberties=new Set(), stack=[start];
    while(stack.length){const p=stack.pop();stones.push(p);for(const q of neighbors(p,size)){if(board[q]===0)liberties.add(q);else if(board[q]===color&&!seen.has(q)){seen.add(q);stack.push(q);}}}
    return {stones,liberties};
  }
  function play(game,index){
    if(game.finished) return {ok:false,error:'Ván đấu đã kết thúc.'};
    if(!Number.isInteger(index)||index<0||index>=game.size*game.size) return {ok:false,error:'Vị trí không hợp lệ.'};
    if(game.board[index]!==0)return {ok:false,error:'Giao điểm này đã có quân.'};
    const color=game.turn, next=game.board.slice(); next[index]=color;
    let captured=0;
    for(const q of neighbors(index,game.size)) if(next[q]===other(color)){
      const g=groupAt(next,game.size,q); if(g.liberties.size===0){captured+=g.stones.length;for(const p of g.stones)next[p]=0;}
    }
    const own=groupAt(next,game.size,index);
    if(own.liberties.size===0)return {ok:false,error:'Nước đi tự sát không được phép.'};
    const nextTurn=other(color), key=keyOf(next,nextTurn);
    if(game.history.includes(key))return {ok:false,error:'Nước đi vi phạm luật Ko / lặp lại thế cờ.'};
    const g={...game,board:next,turn:nextTurn,captures:{...game.captures,[color]:game.captures[color]+captured},passes:0,moveNumber:game.moveNumber+1,history:[...game.history,key],moves:[...game.moves,{color,index,type:'play',captured}]};
    return {ok:true,game:g,captured};
  }
  function score(game){
    const b=game.board,n=game.size,seen=new Set();let black=0,white=0,neutral=0;
    for(let i=0;i<b.length;i++)if(b[i]===BLACK)black++;else if(b[i]===WHITE)white++;
    for(let i=0;i<b.length;i++)if(b[i]===0&&!seen.has(i)){
      const stack=[i],region=[],border=new Set();seen.add(i);
      while(stack.length){const p=stack.pop();region.push(p);for(const q of neighbors(p,n)){if(b[q]===0&&!seen.has(q)){seen.add(q);stack.push(q);}else if(b[q]!==0)border.add(b[q]);}}
      if(border.size===1){const owner=[...border][0];if(owner===BLACK)black+=region.length;else white+=region.length;}else neutral+=region.length;
    }
    white+=game.komi;
    return {black,white,neutral,winner:black>white?BLACK:white>black?WHITE:0,margin:Math.abs(black-white)};
  }
  function pass(game){
    if(game.finished)return {ok:false,error:'Ván đấu đã kết thúc.'};
    const nextTurn=other(game.turn), passes=game.passes+1;
    const g={...game,turn:nextTurn,passes,moveNumber:game.moveNumber+1,history:[...game.history,keyOf(game.board,nextTurn)],moves:[...game.moves,{color:game.turn,type:'pass'}]};
    if(passes>=2){g.finished=true;g.result={type:'score',...score(g)};}
    return {ok:true,game:g};
  }
  function resign(game){if(game.finished)return {ok:false,error:'Ván đấu đã kết thúc.'};const winner=other(game.turn);return {ok:true,game:{...game,finished:true,result:{type:'resign',winner,black:0,white:0,margin:0}}};}
  function legalMoves(game){const a=[];for(let i=0;i<game.board.length;i++)if(game.board[i]===0&&play(game,i).ok)a.push(i);return a;}
  function serialize(game){return {size:game.size,board:game.board,turn:game.turn,captures:game.captures,passes:game.passes,moveNumber:game.moveNumber,moves:game.moves,finished:game.finished,result:game.result,komi:game.komi,history:game.history};}
  const api={BLACK,WHITE,other,newGame,neighbors,groupAt,play,pass,resign,score,legalMoves,serialize};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.GoRules=api;
})(typeof globalThis!=='undefined'?globalThis:this);
