// Small standard GLB writer shared by file-backed integration fixtures.
export function cameraGlb({ times = [0, 1, 2, 3], positions = [[0,1,3],[1,1,3],[-1,1,3],[0,1,3]],
  fovs = [30,35,25,30], rotations, interpolation = 'LINEAR', mutate } = {}) {
  const chunks = [], views = [], accessors = [];
  function accessor(values, width) {
    const flat = values.flat(), bytes = Buffer.alloc(flat.length * 4);
    flat.forEach((v,i) => bytes.writeFloatLE(v,i*4));
    const byteOffset=chunks.reduce((n,b)=>n+b.length,0); chunks.push(bytes);
    const bufferView=views.push({buffer:0,byteOffset,byteLength:bytes.length})-1;
    return accessors.push({bufferView,componentType:5126,count:flat.length/width,type:width===1?'SCALAR':`VEC${width}`,
      ...(width===1?{min:[Math.min(...flat)],max:[Math.max(...flat)]}:{})})-1;
  }
  const input=accessor(times,1);
  // Reflection in X plus the camera's -Z-to-Unity-+Z basis change.
  const p=accessor(positions.map(([x,y,z])=>[-x,y,z]),3);
  const r=accessor(rotations ?? times.map(()=>[0,0,0,1]),4);
  const f=accessor(fovs.map(v=>v*Math.PI/180),1);
  const doc={asset:{version:'2.0'},scene:0,scenes:[{nodes:[0,1]}],nodes:[{name:'MainCamera',camera:0},{name:'OrthoCamera',camera:1,translation:[1,1,3]}],
    cameras:[{type:'perspective',perspective:{yfov:fovs[0]*Math.PI/180,znear:.01,zfar:2000}},
      {type:'orthographic',orthographic:{xmag:2,ymag:1,znear:.01,zfar:2000}}],
    animations:[{name:'Camera',samplers:[{input,output:p,interpolation},{input,output:r,interpolation},{input,output:f,interpolation}],
      channels:[{sampler:0,target:{node:0,path:'translation'}},{sampler:1,target:{node:0,path:'rotation'}},
        {sampler:2,target:{path:'pointer',extensions:{KHR_animation_pointer:{pointer:'/cameras/0/perspective/yfov'}}}}]}],
    extensionsUsed:['KHR_animation_pointer'],extensionsRequired:['KHR_animation_pointer'],accessors,bufferViews:views,
    buffers:[{byteLength:chunks.reduce((n,b)=>n+b.length,0)}]};
  mutate?.(doc);
  return packGlb(doc,Buffer.concat(chunks));
}
export function packGlb(doc, binary = Buffer.alloc(0)) {
  let json=Buffer.from(JSON.stringify(doc));json=Buffer.concat([json,Buffer.alloc((4-json.length%4)%4,32)]);
  const bin=Buffer.concat([binary,Buffer.alloc((4-binary.length%4)%4)]), out=Buffer.alloc(28+json.length+bin.length);
  out.writeUInt32LE(0x46546c67,0);out.writeUInt32LE(2,4);out.writeUInt32LE(out.length,8);
  out.writeUInt32LE(json.length,12);out.writeUInt32LE(0x4e4f534a,16);json.copy(out,20);
  out.writeUInt32LE(bin.length,20+json.length);out.writeUInt32LE(0x004e4942,24+json.length);bin.copy(out,28+json.length);return out;
}
