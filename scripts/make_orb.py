# 2.3: an animated asset for the demo library (a magic orb with orbiting sparks), VP9 with transparency.
# Usage: python3 scripts/make_orb.py demo
import numpy as np, subprocess, sys
W=H=320; N=48; FPS=24
y,x=np.mgrid[0:H,0:W].astype(np.float32)
cx=cy=W/2
dx=(x-cx); dy=(y-cy)
r=np.hypot(dx,dy); a=np.arctan2(dy,dx)
import os
out=os.path.join(sys.argv[1] if len(sys.argv) > 1 else "demo", "asset-orb.webm")
p=subprocess.Popen(['ffmpeg','-y','-hide_banner','-loglevel','error','-f','rawvideo','-pix_fmt','rgba','-s',f'{W}x{H}','-r',str(FPS),'-i','-',
  '-c:v','libvpx-vp9','-pix_fmt','yuva420p','-b:v','0','-crf','34','-auto-alt-ref','0','-row-mt','1','-g','24',out],stdin=subprocess.PIPE)
for i in range(N):
    t=i/N; ph=2*np.pi*t
    R=62+3*np.sin(ph*2)
    # core: swirling bands inside the sphere
    inside=np.clip((R-r)/2.0+0.5,0,1)
    rn=np.clip(r/R,0,1)
    swirl=0.5+0.5*np.sin(a*3 + rn*7 - ph*2)
    swirl2=0.5+0.5*np.sin(a*5 - rn*9 + ph*3)
    z=np.sqrt(np.clip(1-rn**2,0,1))
    shade=0.35+0.65*z
    # highlight
    hx=cx-20; hy=cy-24
    hl=np.exp(-((x-hx)**2+(y-hy)**2)/(2*12**2))
    cr=(0.45*swirl+0.25*swirl2)*shade
    col_core=np.stack([0.35+0.5*cr, 0.25+0.45*cr+0.2*swirl2*shade, 0.75+0.25*cr],-1)
    col_core=np.clip(col_core*shade[...,None]+hl[...,None]*0.9,0,1)
    a_core=inside*(0.85+0.15*z)
    # glow
    g=np.exp(-np.clip(r-R,0,None)/ (22+4*np.sin(ph*2)))*np.clip((r-R+3)/3,0,1)
    a_glow=0.75*g
    col_glow=np.stack([0.55+0*r,0.4+0*r,1.0+0*r],-1)
    # sparks orbiting
    sp=np.zeros_like(r)
    for k in range(6):
        ang=ph+k*2*np.pi/6
        rad=104+8*np.sin(ph*2+k)
        for tr in range(5):
            aa=ang-tr*0.09
            sx=cx+rad*np.cos(aa); sy=cy+rad*np.sin(aa)*0.55
            sp=np.maximum(sp,np.exp(-((x-sx)**2+(y-sy)**2)/(2*(3.2-0.4*tr)**2))*(1-tr*0.18))
    a_sp=np.clip(sp,0,1)
    col_sp=np.stack([0.85+0*r,0.9+0*r,1.0+0*r],-1)
    # composite: glow under core, sparks over
    A=a_glow; C=col_glow*a_glow[...,None]
    C=col_core*a_core[...,None]+C*(1-a_core[...,None]); A=a_core+A*(1-a_core)
    C=col_sp*a_sp[...,None]+C*(1-a_sp[...,None]); A=a_sp+A*(1-a_sp)
    rgb=np.where(A[...,None]>1e-4, C/np.maximum(A[...,None],1e-4),0)
    img=np.concatenate([np.clip(rgb*255,0,255),np.clip(A*255,0,255)[...,None]],-1).astype(np.uint8)
    p.stdin.write(img.tobytes())
p.stdin.close(); p.wait()
print('done', out)
