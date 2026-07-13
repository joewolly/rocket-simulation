import * as THREE from "three";
import type { EnvironmentPreset } from "../game/missions";

export class EnvironmentEffects {
  readonly group=new THREE.Group();
  private readonly rain:THREE.Points;
  private readonly rainPositions:Float32Array;
  private readonly stars:THREE.Points;
  private readonly spray:THREE.Points;
  private readonly sprayPositions:Float32Array;
  private readonly wake:THREE.Group;
  private readonly sun:THREE.Sprite;
  private rainAmount=0;

  constructor(){
    const rng=seeded(1977);
    this.rainPositions=new Float32Array(540*3);
    for(let i=0;i<540;i++)this.resetRain(i,rng,true);
    const rainGeometry=new THREE.BufferGeometry();
    rainGeometry.setAttribute("position",new THREE.BufferAttribute(this.rainPositions,3));
    this.rain=new THREE.Points(rainGeometry,new THREE.PointsMaterial({color:0xcfe0e4,size:.055,transparent:true,opacity:.62,depthWrite:false,blending:THREE.NormalBlending}));
    this.rain.visible=false;

    const starPositions=new Float32Array(420*3);
    for(let i=0;i<420;i++){
      const theta=rng()*Math.PI*2,phi=Math.acos(.08+rng()*.92),radius=185+rng()*25;
      starPositions[i*3]=Math.sin(phi)*Math.cos(theta)*radius;
      starPositions[i*3+1]=Math.cos(phi)*radius+18;
      starPositions[i*3+2]=Math.sin(phi)*Math.sin(theta)*radius;
    }
    const starGeometry=new THREE.BufferGeometry(); starGeometry.setAttribute("position",new THREE.BufferAttribute(starPositions,3));
    this.stars=new THREE.Points(starGeometry,new THREE.PointsMaterial({color:0xd7e5ff,size:.34,transparent:true,opacity:.76,depthWrite:false}));
    this.stars.visible=false;

    this.sprayPositions=new Float32Array(120*3); this.sprayPositions.fill(999);
    const sprayGeometry=new THREE.BufferGeometry(); sprayGeometry.setAttribute("position",new THREE.BufferAttribute(this.sprayPositions,3));
    this.spray=new THREE.Points(sprayGeometry,new THREE.PointsMaterial({color:0xd6eff0,size:.22,transparent:true,opacity:.45,depthWrite:false}));

    this.wake=new THREE.Group();
    for(const x of [-4.7,4.7]){
      const geometry=new THREE.PlaneGeometry(3.2,58,1,18);
      const material=new THREE.MeshBasicMaterial({color:0xc8e2df,transparent:true,opacity:.11,depthWrite:false,side:THREE.DoubleSide});
      const strip=new THREE.Mesh(geometry,material); strip.rotation.x=-Math.PI/2; strip.rotation.z=x<0?-.09:.09; strip.position.set(x,-2.05,31); this.wake.add(strip);
    }
    this.sun=new THREE.Sprite(new THREE.SpriteMaterial({map:discTexture(),transparent:true,opacity:.9,depthWrite:false,blending:THREE.AdditiveBlending}));
    this.sun.position.set(-105,105,-145); this.sun.scale.set(21,21,1);
    this.group.add(this.stars,this.rain,this.spray,this.wake,this.sun);
  }

  apply(preset:EnvironmentPreset){
    this.rainAmount=preset.rain; this.rain.visible=preset.rain>0; this.stars.visible=preset.stars;
    (this.sun.material as THREE.SpriteMaterial).color.setHex(preset.sunColor);
    this.sun.visible=preset.weather!=="storm"&&preset.weather!=="fog";
    this.wake.children.forEach(child=>((child as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity=preset.weather==="storm"?.2:.11);
  }

  update(time:number,dt:number,rocket:{x:number;y:number;z:number},seaState:number,reducedMotion:boolean){
    this.wake.position.y=Math.sin(time*.72)*.04*seaState;
    if(this.rain.visible){
      const speed=reducedMotion?13:24;
      for(let i=0;i<this.rainPositions.length/3;i++){
        this.rainPositions[i*3]+=(1.2+this.rainAmount*2.5)*dt;
        this.rainPositions[i*3+1]-=speed*dt;
        if(this.rainPositions[i*3+1]<-1)this.resetRain(i,seeded(i*31+Math.floor(time)),false,rocket);
      }
      (this.rain.geometry.attributes.position as THREE.BufferAttribute).needsUpdate=true;
    }
    for(let i=0;i<this.sprayPositions.length/3;i++){
      const phase=time*(reducedMotion?.45:1.15)+i*.71;
      const side=i%2?-1:1,along=(i%60)/60*34-16;
      this.sprayPositions[i*3]=side*(7.2+Math.sin(phase)*.35);
      this.sprayPositions[i*3+1]=-1.65+Math.max(0,Math.sin(phase*1.7))*.45*seaState;
      this.sprayPositions[i*3+2]=along;
    }
    (this.spray.geometry.attributes.position as THREE.BufferAttribute).needsUpdate=true;
    ((this.spray.material)as THREE.PointsMaterial).opacity=Math.min(.62,.18+seaState*.14);
  }

  private resetRain(index:number,rng:()=>number,initial:boolean,rocket={x:0,y:18,z:0}){
    this.rainPositions[index*3]=rocket.x+(rng()-.5)*85;
    this.rainPositions[index*3+1]=(initial?rng()*65:rocket.y+35+rng()*24);
    this.rainPositions[index*3+2]=rocket.z+(rng()-.5)*85;
  }
}

function seeded(seed:number){let value=(seed>>>0)||1;return()=>{value=(value*1664525+1013904223)>>>0;return value/4294967296;};}

function discTexture(){
  const canvas=document.createElement("canvas");canvas.width=128;canvas.height=128;const ctx=canvas.getContext("2d")!;
  const gradient=ctx.createRadialGradient(64,64,4,64,64,62);gradient.addColorStop(0,"rgba(255,255,255,1)");gradient.addColorStop(.32,"rgba(255,235,190,.92)");gradient.addColorStop(.55,"rgba(255,170,100,.25)");gradient.addColorStop(1,"rgba(255,150,80,0)");ctx.fillStyle=gradient;ctx.fillRect(0,0,128,128);
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;return texture;
}
