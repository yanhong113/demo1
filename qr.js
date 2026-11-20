// Version 1-L byte-mode QR codes for employee IDs (up to 16 ASCII bytes).
function employeeQR(value) {
  const bytes=new TextEncoder().encode(value);
  if(bytes.length>16)throw new Error('工号过长，无法生成二维码');
  const bits=[];
  const append=(number,count)=>{for(let index=count-1;index>=0;index--)bits.push((number>>>index)&1);};
  append(4,4);append(bytes.length,8);bytes.forEach(byte=>append(byte,8));
  append(0,Math.min(4,152-bits.length));
  while(bits.length%8)bits.push(0);
  const data=[];
  for(let index=0;index<bits.length;index+=8)data.push(bits.slice(index,index+8).reduce((sum,bit)=>sum*2+bit,0));
  while(data.length<19)data.push(data.length%2===(Math.ceil(bits.length/8)%2)?236:17);
  const multiply=(a,b)=>{let result=0;for(let i=0;i<8;i++){if(b&1)result^=a;b>>>=1;a<<=1;if(a&256)a^=285;}return result;};
  let generator=[1],power=1;
  for(let degree=0;degree<7;degree++){
    const next=Array(generator.length+1).fill(0);
    generator.forEach((coefficient,index)=>{next[index]^=coefficient;next[index+1]^=multiply(coefficient,power);});
    generator=next;power=multiply(power,2);
  }
  const remainder=[...data,...Array(7).fill(0)];
  for(let index=0;index<data.length;index++){
    const factor=remainder[index];
    generator.forEach((coefficient,offset)=>{remainder[index+offset]^=multiply(coefficient,factor);});
  }
  const allBits=[];
  for(const byte of [...data,...remainder.slice(-7)])for(let index=7;index>=0;index--)allBits.push((byte>>>index)&1);
  const matrix=Array.from({length:21},()=>Array(21).fill(null));
  const finder=(left,top)=>{for(let y=-1;y<=7;y++)for(let x=-1;x<=7;x++){
    if(left+x<0||top+y<0||left+x>=21||top+y>=21)continue;
    matrix[top+y][left+x]=x>=0&&x<=6&&y>=0&&y<=6&&(x===0||x===6||y===0||y===6||(x>=2&&x<=4&&y>=2&&y<=4));
  }};
  finder(0,0);finder(14,0);finder(0,14);
  for(let index=8;index<13;index++){matrix[6][index]=index%2===0;matrix[index][6]=index%2===0;}
  const format=0x77c4;
  for(let index=0;index<15;index++){
    const bit=!!((format>>>index)&1);
    matrix[index<6?index:index<8?index+1:21-15+index][8]=bit;
    matrix[8][index<8?20-index:index<9?15-index:14-index]=bit;
  }
  matrix[13][8]=true;
  let cursor=0,up=true;
  for(let right=20;right>0;right-=2){
    if(right===6)right--;
    for(let offset=0;offset<21;offset++){
      const y=up?20-offset:offset;
      for(let x=right;x>=right-1;x--)if(matrix[y][x]===null){matrix[y][x]=!!((allBits[cursor++]||0)^((x+y)%2===0?1:0));}
    }
    up=!up;
  }
  return matrix;
}
function drawQR(canvas,value) {
  const matrix=employeeQR(value),context=canvas.getContext('2d');
  const scale=8;canvas.width=232;canvas.height=232;
  context.fillStyle='#fff';context.fillRect(0,0,232,232);context.fillStyle='#102449';
  matrix.forEach((row,y)=>row.forEach((dark,x)=>{if(dark)context.fillRect((x+4)*scale,(y+4)*scale,scale,scale);}));
}
