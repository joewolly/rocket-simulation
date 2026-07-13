import type { Controls } from "../simulation";

export interface GamepadStatus { connected:boolean; name:string; }

export function pollGamepad(controls: Controls,deadzoneAmount=.12): GamepadStatus {
  const pad = navigator.getGamepads?.().find(Boolean);
  if (!pad) {
    controls.pitchAxis = controls.rollAxis = controls.throttleAxis = undefined;
    return { connected:false, name:"" };
  }
  const deadzone = (value:number) => Math.abs(value) < deadzoneAmount ? 0 : Math.sign(value) * (Math.abs(value)-deadzoneAmount)/(1-deadzoneAmount);
  controls.rollAxis = deadzone(pad.axes[0] ?? 0);
  controls.pitchAxis = deadzone(pad.axes[1] ?? 0);
  const triggerThrottle = (pad.buttons[7]?.value ?? 0) - (pad.buttons[6]?.value ?? 0);
  if (Math.abs(triggerThrottle) > .02) controls.throttleAxis = Math.max(0, Math.min(1, .5 + triggerThrottle * .5));
  return { connected:true, name:pad.id };
}

export function pulseGamepad(strength:number,duration=250) {
  const pad=navigator.getGamepads?.().find(Boolean);
  const actuator=pad?.vibrationActuator;
  if(actuator)void actuator.playEffect("dual-rumble",{duration,strongMagnitude:Math.min(1,strength),weakMagnitude:Math.min(1,strength*.65)});
}
