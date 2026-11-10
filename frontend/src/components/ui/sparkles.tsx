import {useEffect,useId,useState} from 'react';
import Particles from '@tsparticles/react';
import {tsParticles,type Container} from '@tsparticles/engine';
import {loadSlim} from '@tsparticles/slim';
import {motion,useAnimation} from 'framer-motion';

type SparklesProps={id?:string;className?:string;background?:string;particleSize?:number;minSize?:number;maxSize?:number;speed?:number;particleColor?:string;particleDensity?:number};

export function SparklesCore({id,className='',background='transparent',minSize=0.4,maxSize=1.4,speed=1,particleColor='#ffffff',particleDensity=90}:SparklesProps){
 const [ready,setReady]=useState(false);const controls=useAnimation();const generatedId=useId();
 useEffect(()=>{let active=true;loadSlim(tsParticles).then(()=>{if(active)setReady(true)});return()=>{active=false}},[]);
 const particlesLoaded=async(container?:Container)=>{if(container)await controls.start({opacity:1,transition:{duration:1}})};
 return <motion.div animate={controls} initial={{opacity:0}} className={className} aria-hidden="true">{ready&&<Particles id={id||generatedId} className="sparkles-canvas" particlesLoaded={particlesLoaded} options={{background:{color:{value:background}},fullScreen:{enable:false},fpsLimit:60,detectRetina:true,interactivity:{events:{onClick:{enable:false,mode:'push'},onHover:{enable:false,mode:'repulse'},resize:true},modes:{push:{quantity:3},repulse:{distance:120,duration:.4}}},particles:{color:{value:particleColor},number:{density:{enable:true,width:400,height:400},value:particleDensity},opacity:{value:{min:.1,max:.8},animation:{enable:true,speed,sync:false}},size:{value:{min:minSize,max:maxSize}},move:{enable:true,direction:'none',outModes:{default:'out'},random:false,speed:{min:.1,max:.45},straight:false},shape:{type:'circle'},links:{enable:false}}}}/>}</motion.div>;
}
