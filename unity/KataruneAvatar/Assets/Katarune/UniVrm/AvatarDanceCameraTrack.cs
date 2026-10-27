using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using UniGLTF;
using UniJSON;
using UnityEngine;

namespace Katarune.Avatar
{
    // Standard glTF curves, evaluated without instantiating the imported scene.
    public sealed class AvatarDanceCameraTrack
    {
        public const int MaxBytes = 16 * 1024 * 1024;
        private const int MaxKeys = 120001;
        private sealed class Curve
        {
            public float[] Times, Values;
            public int Width;
            public string Interpolation;
            public Vector4 At(float seconds, bool rotation = false)
            {
                var low=0; var high=Times.Length-1;
                while(low<high){var m=(low+high+1)/2;if(Times[m]<=seconds)low=m;else high=m-1;}
                var next=Math.Min(low+1,Times.Length-1);var cubic=Interpolation=="CUBICSPLINE";
                Vector4 Value(int index,int part=1)
                {
                    var offset=(index*(cubic?3:1)+(cubic?part:0))*Width;
                    var value=Vector4.zero;for(var i=0;i<Width;i++)value[i]=Values[offset+i];return value;
                }
                var a=Value(low);
                if(seconds<=Times[0] || next==low || Interpolation=="STEP")return a;
                var dt=Times[next]-Times[low];var t=Mathf.Clamp01((seconds-Times[low])/dt);var b=Value(next);
                if(cubic)
                {
                    var t2=t*t;var t3=t2*t;
                    var value=(2*t3-3*t2+1)*a+(t3-2*t2+t)*dt*Value(low,2)+(-2*t3+3*t2)*b+(t3-t2)*dt*Value(next,0);
                    return rotation?Normalize(value):value;
                }
                if(!rotation)return Vector4.Lerp(a,b,t);
                var q=Quaternion.Slerp(new Quaternion(a.x,a.y,a.z,a.w),new Quaternion(b.x,b.y,b.z,b.w),t);
                return new Vector4(q.x,q.y,q.z,q.w);
            }
        }
        private sealed class Node
        {
            public glTFNode Definition;
            public int Parent=-1;
            public Curve Translation,Rotation,Scale;
            public Matrix4x4 At(float seconds)
            {
                if(Definition.matrix?.Length==16)
                {
                    var matrix=new Matrix4x4();for(var i=0;i<16;i++)matrix[i]=Definition.matrix[i];return matrix;
                }
                Vector3 Vector(float[] v,Vector3 fallback)=>v==null?fallback:new Vector3(v[0],v[1],v[2]);
                var t=Translation!=null?(Vector3)Translation.At(seconds):Vector(Definition.translation,Vector3.zero);
                var s=Scale!=null?(Vector3)Scale.At(seconds):Vector(Definition.scale,Vector3.one);
                var r=Rotation?.At(seconds,true)??(Definition.rotation==null?new Vector4(0,0,0,1):new Vector4(Definition.rotation[0],Definition.rotation[1],Definition.rotation[2],Definition.rotation[3]));
                if(s.x<=0 || s.y<=0 || s.z<=0)throw Invalid("相机层级需要正数缩放。");
                return Matrix4x4.TRS(t,new Quaternion(r.x,r.y,r.z,r.w),s);
            }
        }
        private sealed class Lens
        {
            public glTFCamera Definition;
            public Curve Fov,Size,Near,Far;
        }
        private readonly struct Shot
        {
            public readonly float At;
            public readonly int[] Chain;
            public Shot(float at,int[] chain){At=at;Chain=chain;}
        }
        public readonly struct Sample
        {
            public readonly Vector3 Position;
            public readonly Quaternion Rotation;
            public readonly float FieldOfView,OrthographicSize,NearClip,FarClip;
            public readonly bool Orthographic;
            internal Sample(Vector3 p,Quaternion r,float fov,bool ortho,float size,float near,float far)
            {Position=p;Rotation=r;FieldOfView=fov;Orthographic=ortho;OrthographicSize=size;NearClip=near;FarClip=far;}
        }
        private readonly Node[] _nodes;
        private readonly Lens[] _lenses;
        private readonly Shot[] _shots;
        private readonly Dictionary<int,float[]> _accessorArrays=new();
        private int _decodedComponents;
        public float ReferenceHeight{get;}
        public float EndSeconds{get;private set;}

        private AvatarDanceCameraTrack(GltfData data,AvatarPackageCamera settings)
        {
            var g=data.GLTF;
            if(g.asset?.version!="2.0" || g.nodes==null || g.nodes.Count==0 || g.nodes.Count>4096
                || g.cameras==null || g.cameras.Count==0 || g.cameras.Count>256)throw Invalid("缺少有效相机或节点。");
            if((g.buffers?.Count??0)>1 || (g.buffers?.Any(b=>!string.IsNullOrEmpty(b.uri))??false)
                || (g.images?.Any(i=>!string.IsNullOrEmpty(i.uri))??false))throw Invalid("GLB 必须自包含，不能引用外部资源。");
            foreach(var extension in g.extensionsRequired??new List<string>())
                if(extension!="KHR_animation_pointer")throw Invalid("镜头包含不支持的必需扩展。");
            ReferenceHeight=settings?.referenceHeight??0;
            if(!Range(ReferenceHeight,0,10))throw Invalid("参考身高无效。");
            _nodes=g.nodes.Select(n=>new Node{Definition=n}).ToArray();
            _lenses=g.cameras.Select(c=>new Lens{Definition=c}).ToArray();
            for(var i=0;i<_nodes.Length;i++)
            {
                var n=_nodes[i].Definition;
                CheckVector(n.translation,3);CheckVector(n.rotation,4,true);CheckVector(n.scale,3);CheckVector(n.matrix,16);
                if(n.matrix!=null && (n.translation!=null || n.rotation!=null || n.scale!=null))throw Invalid("节点不能混用矩阵与 TRS。");
                if(n.camera < -1 || n.camera>=_lenses.Length)throw Invalid("相机引用无效。");
                foreach(var child in n.children??Array.Empty<int>())
                {
                    if(child<0 || child>=_nodes.Length || _nodes[child].Parent!=-1)throw Invalid("相机层级引用无效。");
                    _nodes[child].Parent=i;
                }
            }
            for(var i=0;i<_nodes.Length;i++)Chain(i);
            if(g.scenes==null || g.scenes.Count==0)throw Invalid("镜头需要 glTF 场景。");
            var scene=g.scene<0?0:g.scene;
            if(scene>=g.scenes.Count)throw Invalid("默认场景无效。");
            var reachable=new HashSet<int>();var pending=new Stack<int>(g.scenes[scene].nodes??Array.Empty<int>());
            while(pending.Count>0)
            {
                var node=pending.Pop();
                if(node<0 || node>=_nodes.Length || !reachable.Add(node))throw Invalid("场景层级无效。");
                foreach(var child in _nodes[node].Definition.children??Array.Empty<int>())pending.Push(child);
            }
            var cameras=reachable.Where(i=>_nodes[i].Definition.camera>=0).ToArray();
            if(settings?.shots?.Length>0)
            {
                if(settings.shots.Length>256)throw Invalid("镜头段过多。");
                var previous=-1f;
                _shots=settings.shots.Select(shot=>{
                    if(shot==null || !Range(shot.at,0,3600) || shot.at<=previous || (previous<0 && shot.at!=0))throw Invalid("镜头段需要从零开始递增。");
                    previous=shot.at;
                    var matches=cameras.Where(i=>!string.IsNullOrEmpty(shot.node) && _nodes[i].Definition.name==shot.node).ToArray();
                    if(matches.Length!=1)throw Invalid("镜头段需要唯一的相机节点名称。");
                    return new Shot(shot.at,Chain(matches[0]));
                }).ToArray();
                EndSeconds=_shots[^1].At;
            }
            else
            {
                if(cameras.Length!=1)throw Invalid("导出单个相机，或在 shots 中指定相机节点名称。");
                _shots=new[]{new Shot(0,Chain(cameras[0]))};
            }
            var animations=g.animations;
            if(animations?.Count>0)
            {
                var selected=animations.ToArray();
                if(!string.IsNullOrEmpty(settings?.animation))
                {
                    var matches=animations.Select((a,i)=>(a,i)).Where(p=>p.a.name==settings.animation).ToArray();
                    if(matches.Length!=1)throw Invalid("动画名称不存在或不唯一。");
                    selected=new[]{matches[0].a};
                }
                var assigned=new HashSet<string>();
                foreach(var animation in selected)
                {
                if(animation.channels.Count>4096 || animation.samplers.Count>4096)throw Invalid("动画通道过多。");
                foreach(var channel in animation.channels)
                {
                    var target=channel.target;var node=target.node;var path=target.path;var camera=-1;
                    if(path=="pointer")
                    {
                        if(!(g.extensionsUsed?.Contains("KHR_animation_pointer")??false))throw Invalid("缺少动画指针扩展声明。");
                        string pointer=null;
                        if(target.extensions is glTFExtensionImport extensions)foreach(var entry in extensions.ObjectItems())
                            if(entry.Key.GetString()=="KHR_animation_pointer")foreach(var property in entry.Value.ObjectItems())
                                if(property.Key.GetString()=="pointer")pointer=property.Value.GetString();
                        var parts=pointer?.Split('/');
                        if(parts==null || parts.Length<4)throw Invalid("动画指针无效。");
                        if(parts.Length==4 && parts[1]=="nodes" && int.TryParse(parts[2],out node))path=parts[3];
                        else if(parts.Length==5 && parts[1]=="cameras" && int.TryParse(parts[2],out camera))
                        {
                            if(camera<0 || camera>=_lenses.Length)throw Invalid("镜头参数引用无效。");
                            var expected=_lenses[camera].Definition.type==ProjectionType.Perspective?"perspective":"orthographic";
                            if(parts[3]!=expected)throw Invalid("镜头参数与投影类型不符。");
                            path=parts[4];
                        }
                        else continue;
                    }
                    if(camera<0 && path=="weights")continue;
                    if(!assigned.Add($"{(camera<0?"node":"camera")}:{(camera<0?node:camera)}:{path}"))throw Invalid("多个通道写入同一属性；请用 animation 选择单个动画。");
                    if(channel.sampler<0 || channel.sampler>=animation.samplers.Count)throw Invalid("动画采样器引用无效。");
                    var sampler=animation.samplers[channel.sampler];
                    if(camera>=0)
                    {
                        var curve=ReadCurve(data,sampler,1,false);
                        switch(path)
                        {
                            case "yfov":_lenses[camera].Fov=curve;break;
                            case "ymag":_lenses[camera].Size=curve;break;
                            case "xmag":break;
                            case "znear":_lenses[camera].Near=curve;break;
                            case "zfar":_lenses[camera].Far=curve;break;
                            case "aspectRatio":break;
                            default:throw Invalid("不支持的相机动画属性。");
                        }
                    }
                    else
                    {
                        if(node<0 || node>=_nodes.Length || _nodes[node].Definition.matrix!=null)throw Invalid("动画节点无效或使用了静态矩阵。");
                        var curve=ReadCurve(data,sampler,path=="rotation"?4:3,path=="rotation");
                        switch(path)
                        {
                            case "translation":_nodes[node].Translation=curve;break;
                            case "rotation":_nodes[node].Rotation=curve;break;
                            case "scale":_nodes[node].Scale=curve;break;
                            default:throw Invalid("不支持的节点动画属性。");
                        }
                    }
                }
                }
            }
            else if(!string.IsNullOrEmpty(settings?.animation))throw Invalid("文件没有指定动画。");
            var checkpoints=new SortedSet<float>(_shots.Select(shot=>shot.At));
            var curves=_nodes.SelectMany(n=>new[]{n.Translation,n.Rotation,n.Scale})
                .Concat(_lenses.SelectMany(l=>new[]{l.Fov,l.Size,l.Near,l.Far})).Where(c=>c!=null);
            foreach(var curve in curves)
                for(var i=0;i<curve.Times.Length;i++)
                {
                    checkpoints.Add(curve.Times[i]);
                    if(curve.Interpolation=="CUBICSPLINE" && i>0)checkpoints.Add((curve.Times[i-1]+curve.Times[i])*.5f);
                }
            foreach(var time in checkpoints)SampleAt(time);
        }
        private int[] Chain(int node)
        {
            var chain=new List<int>();
            for(var cursor=node;cursor>=0;cursor=_nodes[cursor].Parent)
            {if(chain.Count>=_nodes.Length)throw Invalid("相机层级包含循环。");chain.Add(cursor);}
            chain.Reverse();return chain.ToArray();
        }
        private Curve ReadCurve(GltfData data,glTFAnimationSampler sampler,int width,bool rotation)
        {
            var g=data.GLTF;
            if(sampler.input<0 || sampler.input>=g.accessors.Count || sampler.output<0 || sampler.output>=g.accessors.Count)throw Invalid("动画访问器引用无效。");
            var a=g.accessors[sampler.input];var b=g.accessors[sampler.output];
            var interpolation=string.IsNullOrEmpty(sampler.interpolation)?"LINEAR":sampler.interpolation;
            if(interpolation!="LINEAR" && interpolation!="STEP" && interpolation!="CUBICSPLINE")throw Invalid("不支持的插值方式。");
            if(a.count<1 || a.count>MaxKeys || (interpolation=="CUBICSPLINE" && a.count<2)
                || a.type!="SCALAR" || a.componentType!=glComponentType.FLOAT
                || b.type!=(width==1?"SCALAR":$"VEC{width}") || b.componentType!=glComponentType.FLOAT
                || b.count!=a.count*(interpolation=="CUBICSPLINE"?3:1))throw Invalid("动画访问器结构无效。");
            void CheckAccessor(glTFAccessor accessor,int elements)
            {
                if(accessor.sparse!=null || accessor.normalized)throw Invalid("镜头使用未压缩的浮点动画访问器。");
                if(!accessor.bufferView.HasValue || accessor.bufferView.Value<0 || accessor.bufferView.Value>=g.bufferViews.Count)throw Invalid("访问器缺少有效缓冲区。");
                var view=g.bufferViews[accessor.bufferView.Value];var offset=accessor.byteOffset??0;
                var stride=view.byteStride==0?elements*4:view.byteStride;
                if(view.buffer!=0 || view.byteOffset<0 || view.byteLength<0 || (long)view.byteOffset+view.byteLength>data.Bin.Length
                    || g.buffers.Count!=1 || g.buffers[0].byteLength>data.Bin.Length
                    || offset<0 || offset%4!=0 || stride<elements*4 || stride%4!=0
                    || (long)offset+(long)(accessor.count-1)*stride+elements*4>view.byteLength)throw Invalid("动画缓冲区超出文件范围。");
            }
            CheckAccessor(a,1);CheckAccessor(b,width);
            float[] Decode(int index,int components)
            {
                if(_accessorArrays.TryGetValue(index,out var cached))return cached;
                _decodedComponents+=components;
                if(_decodedComponents>8000000)throw Invalid("解码后的镜头曲线过大。");
                var decoded=data.FlatternFloatArrayFromAccessor(index).ToArray();
                if(decoded.Length!=components)throw Invalid("访问器数据长度不符。");
                _accessorArrays.Add(index,decoded);return decoded;
            }
            var times=Decode(sampler.input,a.count);
            var values=Decode(sampler.output,b.count*width);
            var previous=-1f;
            foreach(var t in times){if(!Range(t,0,3600) || t<=previous)throw Invalid("动画时间须严格递增。");previous=t;}
            if(values.Length!=b.count*width || values.Any(v=>!Range(v,-1000000,1000000)))throw Invalid("动画数值无效。");
            if(rotation)for(var i=0;i<times.Length;i++)
            {
                var offset=(i*(interpolation=="CUBICSPLINE"?3:1)+(interpolation=="CUBICSPLINE"?1:0))*4;
                var q=new Vector4(values[offset],values[offset+1],values[offset+2],values[offset+3]);
                if(Mathf.Abs(q.magnitude-1)>.001f)throw Invalid("旋转需要单位四元数。");
            }
            EndSeconds=Mathf.Max(EndSeconds,times[^1]);
            return new Curve{Times=times,Values=values,Width=width,Interpolation=interpolation};
        }
        public static AvatarDanceCameraTrack Read(string path,AvatarPackageCamera settings=null)
        {
            try
            {
                if(new FileInfo(path).Length>MaxBytes)throw Invalid("文件超过 16 MiB。");
                return Parse(File.ReadAllBytes(path),settings);
            }
            catch(InvalidDataException){throw;}
            catch(IOException){throw Invalid("镜头文件不可用。");}
            catch(UnauthorizedAccessException){throw Invalid("无法读取镜头文件。");}
        }
        public static AvatarDanceCameraTrack Parse(byte[] bytes,AvatarPackageCamera settings=null)
        {
            try
            {
                if(bytes==null || bytes.Length<20 || bytes.Length>MaxBytes || BitConverter.ToUInt32(bytes,0)!=0x46546c67
                    || BitConverter.ToUInt32(bytes,4)!=2 || BitConverter.ToUInt32(bytes,8)!=bytes.Length)throw Invalid("需要 glTF 2.0 GLB 文件。");
                using var data=new GlbLowLevelParser("camera.glb",bytes).Parse();
                return new AvatarDanceCameraTrack(data,settings);
            }
            catch(InvalidDataException){throw;}
            catch(Exception error)when(error is not OutOfMemoryException){throw Invalid("GLB 镜头结构或动画数据无效。");}
        }
        public void ValidateDuration(float duration)
        {
            if(!float.IsFinite(duration) || duration<=0 || EndSeconds>duration+.05f)throw Invalid("镜头动画超出动作时长。");
        }
        public Sample SampleAt(float seconds)
        {
            if(!float.IsFinite(seconds))throw new ArgumentOutOfRangeException(nameof(seconds));
            var shot=_shots[0];foreach(var candidate in _shots){if(candidate.At>seconds)break;shot=candidate;}
            var world=Matrix4x4.identity;
            foreach(var node in shot.Chain)world*=_nodes[node].At(seconds);
            var p=world.GetColumn(3);var q=world.rotation;
            var rotation=new Quaternion(q.x,-q.y,-q.z,q.w)*Quaternion.Euler(0,180,0);
            var lens=_lenses[_nodes[shot.Chain[^1]].Definition.camera];var c=lens.Definition;
            var ortho=c.type==ProjectionType.Orthographic;
            if((ortho && c.orthographic==null) || (!ortho && c.perspective==null))throw Invalid("缺少相机投影参数。");
            var fov=ortho?30:(lens.Fov?.At(seconds).x??c.perspective.yfov)*Mathf.Rad2Deg;
            var size=ortho?(lens.Size?.At(seconds).x??c.orthographic.ymag):1;
            var near=lens.Near?.At(seconds).x??(ortho?c.orthographic.znear:c.perspective.znear);
            var far=lens.Far?.At(seconds).x??(ortho?c.orthographic.zfar:c.perspective.zfar);
            if(!ortho && far==0)far=1000;
            if((!ortho && near<=0) || (ortho && !Range(c.orthographic.xmag,.000001f,1000))
                || !Range(p.x,-1000,1000) || !Range(p.y,-1000,1000) || !Range(p.z,-1000,1000)
                || !Range(fov,1,179) || !Range(size,.000001f,1000) || !Range(near,0,100000) || !Range(far,0,1000000) || far<=near
                || !float.IsFinite(rotation.x) || !float.IsFinite(rotation.y) || !float.IsFinite(rotation.z) || !float.IsFinite(rotation.w))throw Invalid("相机采样产生无效位置或投影。");
            return new Sample(new Vector3(-p.x,p.y,p.z),rotation.normalized,fov,ortho,size,Mathf.Max(.001f,near),far);
        }
        private static Vector4 Normalize(Vector4 v)
        {if(v.sqrMagnitude<.00000001f)throw Invalid("旋转插值为零。");return v.normalized;}
        private static void CheckVector(float[] v,int length,bool quaternion=false)
        {
            if(v==null)return;
            if(v.Length!=length || v.Any(x=>!Range(x,-1000000,1000000)))throw Invalid("节点变换无效。");
            if(quaternion && Mathf.Abs(Mathf.Sqrt(v.Sum(x=>x*x))-1)>.001f)throw Invalid("节点旋转需要单位四元数。");
        }
        private static bool Range(float value,float min,float max)=>float.IsFinite(value)&&value>=min&&value<=max;
        private static InvalidDataException Invalid(string reason)=>new("GLB 镜头："+reason);
    }
}
