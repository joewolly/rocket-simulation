import type { FlightPhase } from "../simulation";

export class FlightAudio {
  private context?: AudioContext;
  private master?: GainNode;
  private engineGain?: GainNode;
  private engineOsc?: OscillatorNode;
  private engineSub?: OscillatorNode;
  private windGain?: GainNode;
  private windSource?: AudioBufferSourceNode;
  private previousPhase: FlightPhase = "flying";
  private radarBand = 4;
  enabled = true;

  async unlock() {
    if (!this.enabled) return;
    if (!this.context) this.createGraph();
    await this.context?.resume();
  }

  setEnabled(value:boolean) {
    this.enabled=value;
    if(this.master)this.master.gain.setTargetAtTime(value?.22:0,this.context!.currentTime,.08);
  }

  update(throttle:number, speed:number, stress:number, phase:FlightPhase,altitude=100) {
    if(!this.context||!this.engineGain||!this.engineOsc||!this.windGain)return;
    const t=this.context.currentTime;
    this.engineGain.gain.setTargetAtTime(this.enabled ? .018+throttle*.17 : 0,t,.045);
    this.engineOsc.frequency.setTargetAtTime(42+throttle*58+stress*4,t,.06);
    this.engineSub?.frequency.setTargetAtTime(27+throttle*31,t,.08);
    this.windGain.gain.setTargetAtTime(this.enabled ? Math.min(.12,speed*.008):0,t,.15);
    if(phase!==this.previousPhase){ this.playImpact(phase==="landed"); this.previousPhase=phase; }
    const band=altitude<2?0:altitude<5?1:altitude<10?2:3;
    if(phase==="flying"&&band<this.radarBand)this.playRadarPing(band);
    this.radarBand=altitude>12?4:band;
  }

  private createGraph() {
    this.context=new AudioContext();
    this.master=this.context.createGain(); this.master.gain.value=this.enabled?.22:0; this.master.connect(this.context.destination);
    this.engineGain=this.context.createGain(); this.engineGain.gain.value=0; this.engineGain.connect(this.master);
    this.engineOsc=this.context.createOscillator(); this.engineOsc.type="sawtooth"; this.engineOsc.frequency.value=45;
    const filter=this.context.createBiquadFilter(); filter.type="lowpass"; filter.frequency.value=240;
    this.engineOsc.connect(filter).connect(this.engineGain); this.engineOsc.start();
    this.engineSub=this.context.createOscillator();this.engineSub.type="sine";this.engineSub.frequency.value=28;this.engineSub.connect(this.engineGain);this.engineSub.start();
    const buffer=this.context.createBuffer(1,this.context.sampleRate*2,this.context.sampleRate);
    const data=buffer.getChannelData(0); for(let i=0;i<data.length;i++)data[i]=(Math.random()*2-1)*(.5+.5*Math.sin(i*.013));
    this.windSource=this.context.createBufferSource(); this.windSource.buffer=buffer; this.windSource.loop=true;
    const windFilter=this.context.createBiquadFilter(); windFilter.type="bandpass"; windFilter.frequency.value=720; windFilter.Q.value=.6;
    this.windGain=this.context.createGain(); this.windGain.gain.value=0; this.windSource.connect(windFilter).connect(this.windGain).connect(this.master); this.windSource.start();
  }

  private playImpact(success:boolean) {
    if(!this.context||!this.master||!this.enabled)return;
    const osc=this.context.createOscillator(),gain=this.context.createGain(),t=this.context.currentTime;
    osc.type=success?"sine":"sawtooth"; osc.frequency.setValueAtTime(success?86:58,t); osc.frequency.exponentialRampToValueAtTime(success?42:24,t+.7);
    gain.gain.setValueAtTime(.32,t); gain.gain.exponentialRampToValueAtTime(.001,t+.8); osc.connect(gain).connect(this.master); osc.start(t); osc.stop(t+.82);
  }

  private playRadarPing(band:number){
    if(!this.context||!this.master||!this.enabled)return;
    const osc=this.context.createOscillator(),gain=this.context.createGain(),t=this.context.currentTime;
    osc.type="sine";osc.frequency.value=band===0?960:band===1?760:620;gain.gain.setValueAtTime(.055,t);gain.gain.exponentialRampToValueAtTime(.001,t+.11);osc.connect(gain).connect(this.master);osc.start(t);osc.stop(t+.12);
  }
}
