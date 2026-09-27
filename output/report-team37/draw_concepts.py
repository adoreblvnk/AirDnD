"""Vector-first conceptual diagrams; no computed flight trajectories."""
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, Polygon, Circle

FIG=Path(__file__).resolve().parent/'figures'
BLUE='#29618b'; INK='#26343f'; GREY='#8d99a3'; AMBER='#a57b25'
plt.rcParams.update({'font.family':'DejaVu Sans','font.size':8})
checked=[]

def frame(height):
    fig,ax=plt.subplots(figsize=(3.4,height))
    ax.set_xlim(0,10); ax.set_ylim(0,10); ax.axis('off')
    fig.subplots_adjust(left=.015,right=.985,bottom=.025,top=.98)
    return fig,ax

def box(ax,x,y,w,h,label,face='#f0f5f8',size=8):
    patch=FancyBboxPatch((x,y),w,h,boxstyle='round,pad=0.02,rounding_size=0.12',lw=.65,edgecolor=GREY,facecolor=face)
    ax.add_patch(patch)
    text=ax.text(x+w/2,y+h/2,label,ha='center',va='center',fontsize=size,color=INK,linespacing=1.2)
    checked.append((ax,patch,text))

def arrow(ax,a,b,color=GREY):
    ax.annotate('',xy=b,xytext=a,arrowprops={'arrowstyle':'->','lw':.85,'color':color})

def save(fig,name):
    fig.canvas.draw()
    renderer=fig.canvas.get_renderer()
    for ax,patch,text in checked:
        if ax.figure is fig:
            p=patch.get_window_extent(renderer); t=text.get_window_extent(renderer)
            assert p.x0<t.x0 and p.x1>t.x1 and p.y0<t.y0 and p.y1>t.y1, text.get_text()
    fig.savefig(FIG/(name+'.png'),dpi=360,facecolor='white')
    fig.savefig(FIG/(name+'.svg'),facecolor='white')
    fig.savefig(FIG/(name+'.pdf'),facecolor='white')
    plt.close(fig)

fig,ax=frame(2.3)
box(ax,1.35,8.65,7.3,1.0,'Visible physical scene',size=8)
for x,label in [(.3,'A'),(5.8,'B')]:
    center=x+1.95
    box(ax,x,6.2,3.9,1.5,'Local view '+label,size=8)
    box(ax,x,3.65,3.9,1.65,'HUSH\nhistory + beliefs',size=7.6)
    box(ax,x,1.1,3.9,1.65,'Own rules\n+ safety filter',size=7.6)
    arrow(ax,(center,8.58),(center,7.78))
    arrow(ax,(center,6.12),(center,5.4))
    arrow(ax,(center,3.57),(center,2.83))
ax.text(5,.18,'Zero coordination messages',ha='center',fontsize=7.6,color=INK)
save(fig,'hush-architecture')

fig,ax=frame(2.85)
ax.plot([.5,9.6],[1.2,1.2],color=GREY,lw=.6)
for x,label in [(1.7,'A'),(5,'B'),(8.3,'C')]:
    ax.text(x,.42,label,ha='center',color=GREY,fontsize=8)
for x in [3.33,6.66]: ax.plot([x,x],[.35,1.2],color=GREY,lw=.5)
ax.text(.45,9.6,'Side elevation',fontsize=8,color=GREY)
obs=(5.3,7.55); inter=(2.7,2.6); track=(8.2,2.6)
ax.add_patch(Polygon([obs,(1.5,2),(9.1,2)],closed=True,fc='#edf4f8',ec='none'))
ax.add_patch(Polygon([inter,(9.35,1.8),(9.35,3.4)],closed=True,fc='#fff3d8',ec=AMBER,lw=.6,alpha=.7))
for end in [inter,track]: ax.plot([obs[0],end[0]],[obs[1],end[1]],'--',lw=.9,color=BLUE)
ax.scatter(*obs,s=115,marker='D',c=BLUE,zorder=5)
ax.scatter(*inter,s=115,marker='D',c=BLUE,zorder=5)
ax.scatter(*track,s=85,marker='o',c='#be7064',zorder=5)
ax.text(5.3,8.35,'Observer',ha='center',fontsize=9,color=INK)
ax.text(1.25,4.05,'Downward view',ha='left',fontsize=8,color=BLUE)
ax.text(2.4,1.65,'Interceptor',ha='center',fontsize=8,color=INK)
ax.text(8.15,1.65,'Tracked object',ha='center',fontsize=8,color=INK)
ax.text(6.3,3.8,'Forward view',ha='center',fontsize=8,color=AMBER)
ax.annotate('',xy=(.45,7.55),xytext=(.45,2.6),arrowprops={'arrowstyle':'<->','lw':.6,'color':GREY})
ax.text(.05,5.3,'Height',rotation=90,ha='center',va='center',fontsize=7,color=GREY)
save(fig,'local-visibility')

fig,ax=frame(2.35)
ax.text(.25,9.45,'The same scene, different local histories',fontsize=8.2,color=INK)
columns=[(2.3,'Visible'),(5.1,'View lost'),(7.9,'Seen again')]
for x,label in columns: ax.text(x,8.4,label,ha='center',fontsize=7.6,color=INK)
ax.text(.12,6.5,'I',ha='left',fontsize=10,color=BLUE)
ax.text(.12,3.3,'O',ha='left',fontsize=10,color=BLUE)
for y in [6.6,3.4]: ax.plot([1.1,9.2],[y,y],lw=.8,color=GREY,zorder=0)
for x,label in columns:
    for y in [6.6,3.4]:
        memory=(x==5.1 and y==6.6)
        ax.add_patch(Circle((x,y),.43,fc='#fff3d8' if memory else '#e4eff6',ec=AMBER if memory else BLUE,lw=1.1))
        ax.text(x,y,'?' if memory else '•',ha='center',va='center',fontsize=13,color=AMBER if memory else BLUE)
    ax.text(x,5.42,'Memory only' if x==5.1 else 'Observation',ha='center',fontsize=7,color=AMBER if x==5.1 else BLUE)
    ax.text(x,2.2,'Observation',ha='center',fontsize=7,color=BLUE)
ax.text(.25,.64,'I  Interceptor     O  Observer',fontsize=7.4,color=INK)
save(fig,'observation-memory')

fig,ax=frame(3.05)
ax.text(2.25,9.7,'OFFLINE PREPARATION',ha='center',fontsize=7.1,color=BLUE)
ax.text(7.75,9.7,'LOCAL EXECUTION',ha='center',fontsize=7.1,color=BLUE)
left=[(7.85,'Synthetic data\n+ reference labels'),(5.75,'Train / held-out\nchecks'),(3.65,'PyTorch\nmodel'),(1.55,'ONNX / INT8\nexport checks')]
right=[(7.85,'Local observation\nhistory'),(5.75,'MLP + GRU\ninference'),(3.65,'Belief\nestimates'),(1.55,'Application logic\n+ safety filter')]
for x,rows in [(.25,left),(5.75,right)]:
    for y,label in rows: box(ax,x,y,4,1.42,label,size=7.4)
    for high,low in [(7.85,7.17),(5.75,5.07),(3.65,2.97)]:
        arrow(ax,(x+2,high-.06),(x+2,low+.06))
# Prepared model is loaded into inference, with a clear label on the cross-lane link.
ax.plot([4.3,4.93,4.93],[4.36,4.36,6.46],lw=.8,color=BLUE)
arrow(ax,(4.93,6.46),(5.68,6.46),BLUE)
ax.text(4.73,5.2,'Load',ha='center',rotation=90,fontsize=6.8,color=BLUE)
box(ax,.25,.02,9.5,.82,'Event logs  →  FastAPI  →  React / Cesium replay',size=7.0)
arrow(ax,(7.75,1.48),(7.75,.91))
save(fig,'system-architecture')

fig,ax=frame(1.38)
ax.text(.25,9.1,'Generic binary event E',fontsize=8,color=INK)
ax.plot([.6,9.4],[5.45,5.45],lw=4,color='#e3e8ec',solid_capstyle='round')
ax.plot([.6,7.64],[5.45,5.45],lw=4,color=BLUE,solid_capstyle='round')
ax.scatter([7.64],[5.45],s=40,c=BLUE,zorder=5)
for x,label in [(.6,'0'),(5,'0.5'),(9.4,'1')]:ax.text(x,3.2,label,ha='center',fontsize=7.5,color=GREY)
ax.text(7.64,7.3,r'$\hat p=0.8$',ha='center',fontsize=9,color=BLUE)
ax.text(5,.6,'Calibrated: about 80 events per 100 similar cases',ha='center',fontsize=7.3,color=INK)
save(fig,'probability-meaning')

fig,ax=frame(1.94)
box(ax,.2,6.1,4.2,3.0,'Observed scene\nCamera / local tracks',size=7.4)
box(ax,5.6,6.1,4.2,3.0,'Own state\nNavigation / energy',size=7.4)
box(ax,.2,1.8,4.2,3.0,'Evidence quality\nAge / uncertainty / identity',size=6.9)
box(ax,5.6,1.8,4.2,3.0,'Preloaded context\nSectors / boundaries',size=7.4)
ax.text(5,.45,'Each aircraft maintains its own local view',ha='center',fontsize=7.4,color=BLUE)
save(fig,'information-roles')

# Three independent views of the same conceptual scene. Symbols convey
# observation status; no shared state, targeting advice or measurements.
fig,ax=frame(1.85)
ax.text(5,9.55,'Same scene · separate local records',ha='center',fontsize=8,color=INK)
objects=[(.65,6.6,'A'),(1.95,5.1,'B'),(1.15,3.6,'C')]
states=[['seen','memory','unknown'],['memory','seen','seen'],['seen','unknown','seen']]
for idx,x in enumerate([.12,3.48,6.84]):
    panel=FancyBboxPatch((x,2.4),3.03,6.05,boxstyle='round,pad=0.02,rounding_size=0.12',lw=.65,edgecolor=GREY,facecolor='#fafcfd')
    ax.add_patch(panel)
    ax.text(x+1.515,7.75,'Drone '+str(idx+1),ha='center',fontsize=7.4,color=INK)
    for (dx,y,label),state in zip(objects,states[idx]):
        if state=='unknown':
            ax.text(x+dx,y,'?',ha='center',va='center',fontsize=11,color=GREY)
        else:
            ax.add_patch(Circle((x+dx,y),.23,fc=BLUE if state=='seen' else 'none',ec=BLUE if state=='seen' else AMBER,lw=1.1,linestyle='solid' if state=='seen' else '--'))
        ax.text(x+dx+.34,y,label,ha='left',va='center',fontsize=7,color=INK)
ax.scatter([.48],[1.25],s=22,c=BLUE)
ax.text(.78,1.25,'Visible',va='center',fontsize=7,color=INK)
ax.add_patch(Circle((3.65,1.25),.17,fc='none',ec=AMBER,lw=1.0,linestyle='--'))
ax.text(3.98,1.25,'Remembered',va='center',fontsize=7,color=INK)
ax.text(7.75,1.25,'?',ha='center',va='center',fontsize=10,color=GREY)
ax.text(8.05,1.25,'Unknown',va='center',fontsize=7,color=INK)
save(fig,'separate-local-views')
print('Created conceptual diagrams; all box labels fit.')
