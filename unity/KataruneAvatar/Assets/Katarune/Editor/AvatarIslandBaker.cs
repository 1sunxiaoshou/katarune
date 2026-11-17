using System;
using System.Collections.Generic;
using System.Linq;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;

namespace Katarune.Avatar.Editor
{
    // Offline art tool. None of the terrain/plant construction code enters the Player.
    public sealed class AvatarIslandBaker
    {
        private readonly Geometry _land = new();
        private readonly Geometry _leaves = new();
        private readonly Geometry _clouds = new();
        private readonly Geometry _water = new();
        private readonly Geometry _driftwood = new();
        private readonly Geometry _coconut = new();
        private readonly System.Random _random = new(715);
        private const float Sea = -.27f;
        private static Color C(string value) { ColorUtility.TryParseHtmlString(value, out var color); return color.linear; }
        private float Random(float min, float max) => Mathf.Lerp(min, max, (float)_random.NextDouble());
        private static float Noise(float x, float z) => Mathf.PerlinNoise(x + 39.7f, z + 81.3f);

        // Packed pigment and grain maps. Bake once as a mipmapped texture asset;
        // the Player samples it and never synthesizes surface resources.
        private static void BakeSurfacePaint(string folder)
        {
            const int resolution=1024;
            var texture=new Texture2D(resolution,resolution,TextureFormat.RGBA32,false,true);
            var pixels=new Color32[resolution*resolution];
            float Tile(float x,float y,float frequency)
            {
                var a=Noise(x*frequency,y*frequency);
                var b=Noise((x-1)*frequency,y*frequency);
                var c=Noise(x*frequency,(y-1)*frequency);
                var d=Noise((x-1)*frequency,(y-1)*frequency);
                return Mathf.Lerp(Mathf.Lerp(a,b,Mathf.SmoothStep(0,1,x)),Mathf.Lerp(c,d,Mathf.SmoothStep(0,1,x)),Mathf.SmoothStep(0,1,y));
            }
            for(var y=0;y<resolution;y++) for(var x=0;x<resolution;x++)
            {
                var u=x/(float)resolution; var v=y/(float)resolution;
                var broad=Tile(u,v,8)*.55f+Tile(u,v,19)*.30f+Tile(u,v,51)*.15f;
                var pigment=Mathf.Lerp(broad,Mathf.Round(broad*8)/8,.42f);
                var grain=Tile(u,v,96)*.6f+Tile(u,v,215)*.4f;
                var striation=Tile(u,v,27);
                pixels[y*resolution+x]=new Color(pigment,striation,grain,1);
            }
            texture.SetPixels32(pixels); texture.Apply();
            var path=folder+"IslandSurfacePaint.png";
            System.IO.File.WriteAllBytes(path,texture.EncodeToPNG());
            UnityEngine.Object.DestroyImmediate(texture);
            AssetDatabase.ImportAsset(path,ImportAssetOptions.ForceSynchronousImport);
            var importer=(TextureImporter)AssetImporter.GetAtPath(path);
            importer.sRGBTexture=false;
            importer.mipmapEnabled=true;
            importer.wrapMode=TextureWrapMode.Repeat;
            importer.filterMode=FilterMode.Trilinear;
            importer.anisoLevel=4;
            importer.textureCompression=TextureImporterCompression.CompressedHQ;
            importer.SaveAndReimport();

            const int waterSize=512;
            var waterTexture=new Texture2D(waterSize,waterSize,TextureFormat.RGBA32,false,true);
            var waterPixels=new Color32[waterSize*waterSize];
            float Wave(float u,float v)
            {
                var a=u*Mathf.PI*2; var b=v*Mathf.PI*2;
                return Mathf.Sin(a*3+Mathf.Sin(b*2))*.6f+Mathf.Sin(a*2-b*5)*.25f
                    +Mathf.Sin(a*7+b*3+Mathf.Sin(b*4)*.5f)*.15f;
            }
            const float e=1f/waterSize;
            for(var y=0;y<waterSize;y++) for(var x=0;x<waterSize;x++)
            {
                var u=x/(float)waterSize; var v=y/(float)waterSize;
                var dx=(Wave(u+e,v)-Wave(u-e,v))/(2*e);
                var dy=(Wave(u,v+e)-Wave(u,v-e))/(2*e);
                var n=new Vector3(-dx*.025f,-dy*.025f,1).normalized;
                waterPixels[y*waterSize+x]=new Color(n.x*.5f+.5f,n.y*.5f+.5f,n.z*.5f+.5f,1);
            }
            waterTexture.SetPixels32(waterPixels); waterTexture.Apply();
            path=folder+"IslandWaterNormal.png";
            System.IO.File.WriteAllBytes(path,waterTexture.EncodeToPNG());
            UnityEngine.Object.DestroyImmediate(waterTexture);
            AssetDatabase.ImportAsset(path,ImportAssetOptions.ForceSynchronousImport);
            importer=(TextureImporter)AssetImporter.GetAtPath(path);
            importer.sRGBTexture=false;
            importer.mipmapEnabled=true;
            importer.wrapMode=TextureWrapMode.Repeat;
            importer.filterMode=FilterMode.Trilinear;
            importer.anisoLevel=4;
            importer.SaveAndReimport();
        }

        public static void BakeAndCapture()
        {
            Bake();
            AvatarImmersivePreview.Capture();
        }

        [MenuItem("Katarune/美术/烘焙异世界海岸资源")]
        public static void Bake()
        {
            const string folder = "Assets/Katarune/Resources/Immersive/";
            const string libraryPath = folder + "IslandCoastMeshes.asset";
            var library = AssetDatabase.LoadAssetAtPath<AvatarIslandMeshLibrary>(libraryPath);
            if (library == null)
            {
                library = ScriptableObject.CreateInstance<AvatarIslandMeshLibrary>();
                AssetDatabase.CreateAsset(library, libraryPath);
            }
            var previousMeshes = AssetDatabase.LoadAllAssetsAtPath(libraryPath).OfType<Mesh>().ToArray();
            var shader = Resources.Load<Shader>("Immersive/Island")
                ?? throw new InvalidOperationException("异世界海岸材质缺失。");
            var baker = new AvatarIslandBaker();
            BakeSurfacePaint(folder);
            var leafImporter=(TextureImporter)AssetImporter.GetAtPath(folder+"IslandLeafCluster.png");
            leafImporter.sRGBTexture=false;
            leafImporter.mipmapEnabled=true;
            leafImporter.filterMode=FilterMode.Trilinear;
            leafImporter.SaveAndReimport();
            baker.BuildCoast();
            var root = new GameObject("Katarune island coast");
            root.SetActive(false);
            try
            {
                baker.SavePart(root, baker._water, "Lagoon", shader, 1, library, previousMeshes, folder);
                baker.SavePart(root, baker._land, "Coast", shader, 0, library, previousMeshes, folder);
                baker.SavePart(root, baker._leaves, "Plants", shader, 2, library, previousMeshes, folder);
                baker.SavePart(root, baker._clouds, "Clouds", shader, 3, library, previousMeshes, folder);
                baker.SavePart(root, baker._driftwood, "Driftwood", shader, 0, library, previousMeshes, folder);
                baker.SavePart(root, baker._coconut, "Coconut", shader, 0, library, previousMeshes, folder);
                var coconut=root.transform.Find("Coconut").gameObject;
                coconut.AddComponent<SphereCollider>().radius=.085f;
                var coconutBody=coconut.AddComponent<Rigidbody>();
                coconutBody.mass=.65f;
                coconutBody.linearDamping=.35f;
                coconutBody.angularDamping=.55f;
                coconutBody.solverIterations=12;
                coconutBody.solverVelocityIterations=4;
                coconutBody.interpolation=RigidbodyInterpolation.Interpolate;
                coconutBody.collisionDetectionMode=CollisionDetectionMode.ContinuousDynamic;
                coconut.AddComponent<AvatarIslandProp>();
                coconut.transform.localPosition=new Vector3(.25f,.08f,.13f);
                var second=UnityEngine.Object.Instantiate(coconut,root.transform);
                second.name="Coconut left";
                second.transform.localPosition=new Vector3(-.28f,.08f,-.14f);
                var third=UnityEngine.Object.Instantiate(coconut,root.transform);
                third.name="Coconut on crate";
                third.transform.localPosition=new Vector3(.60f,.645f,.12f);
                var collision=new Geometry();
                const int gx=84,gz=56;
                Vector3 P(int x,int z)=>Grounded(-21+x*.5f,-10+z*.5f);
                for(var z=0;z<gz;z++) for(var x=0;x<gx;x++)
                    collision.Quad(P(x,z),P(x,z+1),P(x+1,z+1),P(x+1,z),Color.white);
                var ground=new GameObject("Beach collision");
                ground.transform.SetParent(root.transform,false);
                ground.AddComponent<MeshCollider>().sharedMesh=SaveMesh(collision,"BeachCollision",library,previousMeshes);
                // Give the flat interaction patch thickness when a hand presses
                // a small prop against another object. The visible surface matches.
                var stageSupport=ground.AddComponent<BoxCollider>();
                stageSupport.center=new Vector3(0,-.225f,.4f);
                stageSupport.size=new Vector3(3,.4f,2.8f);
                var crateCollision=ground.AddComponent<BoxCollider>();
                crateCollision.center=new Vector3(.60f,.26f,.12f);
                crateCollision.size=new Vector3(.34f,.56f,.34f);
                var driftwood=root.transform.Find("Driftwood");
                driftwood.localPosition=new Vector3(-1.1f,Sea+.03f,-7.7f);
                driftwood.localRotation=Quaternion.Euler(0,18,0);
                var collider=driftwood.gameObject.AddComponent<BoxCollider>();
                collider.size=new Vector3(.9f,.16f,.25f);
                var body=driftwood.gameObject.AddComponent<Rigidbody>();
                body.mass=9;
                body.linearDamping=.35f;
                body.angularDamping=1.1f;
                body.interpolation=RigidbodyInterpolation.Interpolate;
                driftwood.gameObject.AddComponent<AvatarIslandBuoyancy>();
                PrefabUtility.SaveAsPrefabAsset(root, folder + "IslandCoast.prefab", out var success);
                if (!success) throw new InvalidOperationException("海岸 Prefab 烘焙失败。");
                EditorUtility.SetDirty(library);
                AssetDatabase.SaveAssets();
                Debug.Log("KATARUNE_ISLAND_ART_BAKED");
            }
            finally { UnityEngine.Object.DestroyImmediate(root); }
        }

        private void SavePart(GameObject root, Geometry geometry, string name, Shader shader, int mode,
            AvatarIslandMeshLibrary library, Mesh[] previousMeshes, string folder)
        {
            var mesh=SaveMesh(geometry,name,library,previousMeshes);
            SaveRenderer(root,mesh,name,shader,mode,folder);
        }

        private static Mesh SaveMesh(Geometry geometry,string name,AvatarIslandMeshLibrary library,Mesh[] previousMeshes)
        {
            var generated = new Mesh { name = name, indexFormat = IndexFormat.UInt32 };
            generated.SetVertices(geometry.Vertices);
            generated.SetNormals(geometry.Normals);
            generated.SetColors(geometry.Colors);
            generated.SetUVs(0, geometry.Uvs);
            generated.SetTriangles(geometry.Indices, 0);
            generated.RecalculateBounds();
            var bounds = generated.bounds; bounds.Expand(.5f); generated.bounds = bounds;
            MeshUtility.Optimize(generated);
            var mesh = previousMeshes.SingleOrDefault(value => value.name == name);
            if (mesh != null)
            {
                mesh.Clear();
                EditorUtility.CopySerialized(generated, mesh);
                UnityEngine.Object.DestroyImmediate(generated);
                EditorUtility.SetDirty(mesh);
            }
            else { mesh = generated; AssetDatabase.AddObjectToAsset(mesh, library); }
            geometry.Clear();
            return mesh;
        }

        private static void SaveRenderer(GameObject root,Mesh mesh,string name,Shader shader,int mode,string folder)
        {
            var materialPath = folder + "Island" + name + ".mat";
            var material = AssetDatabase.LoadAssetAtPath<Material>(materialPath);
            if (material == null)
            {
                material = new Material(shader) { name = "Island " + name };
                AssetDatabase.CreateAsset(material, materialPath);
            }
            material.shader = shader;
            material.SetFloat("_Mode", mode);
            material.SetFloat("_Opacity", 1);
            material.SetTexture("_SurfacePaint", AssetDatabase.LoadAssetAtPath<Texture2D>(folder + "IslandSurfacePaint.png"));
            material.SetTexture("_LeafCluster", AssetDatabase.LoadAssetAtPath<Texture2D>(folder + "IslandLeafCluster.png"));
            material.SetTexture("_WaterNormal", AssetDatabase.LoadAssetAtPath<Texture2D>(folder + "IslandWaterNormal.png"));
            AvatarIslandWater.Apply(material);
            material.renderQueue = mode == 1 ? (int)RenderQueue.Transparent : (int)RenderQueue.Geometry;
            EditorUtility.SetDirty(material);
            var child = new GameObject(name);
            child.transform.SetParent(root.transform, false);
            child.AddComponent<MeshFilter>().sharedMesh = mesh;
            var renderer = child.AddComponent<MeshRenderer>();
            renderer.sharedMaterial = material;
            renderer.shadowCastingMode = mode == 0 || mode == 2 ? ShadowCastingMode.TwoSided : ShadowCastingMode.Off;
            renderer.receiveShadows = mode != 3;
            renderer.lightProbeUsage = LightProbeUsage.Off;
            renderer.reflectionProbeUsage = ReflectionProbeUsage.Off;
            Debug.Log($"ISLAND_MESH {name} vertices={mesh.vertexCount}");
        }

        // A curved cove: terrain height is also used for deterministic plant/rock
        // placement, so vegetation meets the ground instead of floating above it.
        private static float Shore(float x) => AvatarIslandWater.Shore(x);
        private static float Ground(float x, float z)
        {
            var inland = z - Shore(x);
            var slope = Mathf.SmoothStep(0, 1, Mathf.InverseLerp(-1.2f, 1.7f, inland));
            var height = Mathf.Lerp(-.65f, -.025f, slope);
            height -= Mathf.Pow(Mathf.Max(0,-inland-1.2f),1.3f)*.55f;
            var hills = Mathf.SmoothStep(0, 1, Mathf.InverseLerp(3.2f, 7.5f, Mathf.Abs(x)));
            height += hills * slope * (.18f + Noise(x * .25f, z * .25f) * 1.1f);
            return height;
        }
        private static Vector3 Grounded(float x, float z) => new(x, Ground(x, z), z);

        private void BuildCoast()
        {
            BuildWater();
            Ellipsoid(_coconut,Vector3.zero,new(.085f,.08f,.085f),C("#98764D"),2,20,12);
            for(var i=0;i<3;i++)
                Ellipsoid(_coconut,new Vector3((i-1)*.018f,.075f,.015f),new(.009f,.006f,.009f),C("#4A4835"),2,8,4);
            // A small supply crate puts a loose prop within animated hand reach.
            for(var i=0;i<5;i++)
                Box(new Vector3(.60f,.035f+i*.11f,.12f),new(.34f,.103f,.34f),C(i%2==0 ? "#B29572":"#C7AC87"),2);
            foreach(var side in new[]{-1,1})
            {
                Box(new Vector3(.60f+side*.125f,.26f,.298f),new(.035f,.56f,.022f),C("#947959"),2);
                Box(new Vector3(.60f+side*.125f,.548f,.12f),new(.035f,.025f,.36f),C("#D0BA94"),2);
            }
            Tube(_driftwood,new(-.43f,0,0),new(.43f,0,0),.085f,C("#BFA17C"),14,2);
            Tube(_driftwood,new(.18f,.02f,0),new(.28f,.13f,.06f),.025f,C("#AA8C70"),9,2);
            Tube(_driftwood,new(-.13f,0,0),new(-.22f,.04f,-.15f),.025f,C("#AA8C70"),9,2);
            Tube(_driftwood,new(-.435f,0,0),new(-.44f,0,0),.078f,C("#E0C9A3"),14,2);
            Tube(_driftwood,new(.43f,0,0),new(.44f,0,0),.078f,C("#E0C9A3"),14,2);
            const int nx = 120, nz = 80;
            Vector3 Point(int x, int z) { var px = -21 + x * .35f; var pz = -10 + z * .35f; return Grounded(px, pz); }
            for (var z=0; z<nz; z++) for (var x=0; x<nx; x++)
            {
                var a=Point(x,z); var b=Point(x+1,z); var c=Point(x+1,z+1); var d=Point(x,z+1);
                var grass = Mathf.Abs(a.x)>4.7f && a.z>Shore(a.x)+1.8f+Noise(a.x*.9f,a.z*.9f);
                var color = grass ? Color.Lerp(C("#638F48"),C("#BADB59"),Noise(a.x*.5f,a.z*.5f)) : C("#F5DBAC");
                _land.Quad(a,d,c,b,color,grass ? 5 : 0);
            }
            // Framing groups have larger continuous fronds, layered shrub masses,
            // coral flowers and seed-driven ground cover around a clear central stage.
            Palm(Grounded(3.3f,-4.4f),2.7f,-.55f,18);
            Palm(Grounded(6.2f,-.8f),5.1f,-.95f,43);
            Palm(Grounded(-3.4f,-4.7f),3.0f,.5f,86);
            Palm(Grounded(-6.8f,.6f),5.4f,1.0f,122);
            Palm(Grounded(4.8f,2.6f),4.7f,-.65f,203);
            Palm(Grounded(-8.5f,-.6f),4.3f,.9f,244);
            foreach (var side in new[]{-1,1})
            {
                for(var i=0;i<18;i++)
                {
                    var p=Grounded(side*Random(1.65f,3.2f),Random(-1.7f,.5f));
                    Shrub(p,Random(.32f,.65f));
                    if(i%3==0) Flower(p,Random(.18f,.3f),i*37);
                }
                for(var i=0;i<38;i++)
                {
                    var x=side*Random(3.0f,12f); var z=Random(-1.8f,7);
                    var p=Grounded(x,z);
                    if(p.y<-.09f) continue;
                    Shrub(p,Random(.25f,.7f));
                    if(i%2==0) Fern(p+new Vector3(.16f,0,.1f),Random(.32f,.65f));
                    if(i%3==0) Flower(p+Vector3.up*.2f,Random(.26f,.43f),i*51);
                }
                for(var i=0;i<90;i++)
                {
                    var x=side*Random(2.6f,11); var z=Random(-1.8f,8);
                    var p=Grounded(x,z);
                    if(p.y<-.08f) continue;
                    Grass(p,Random(.12f,.34f),i*32);
                }
            }
            // Beach debris is sparse and small near the character.
            for(var i=0;i<85;i++)
            {
                var x=Random(-8,8); var z=Random(-3,6);
                if(x*x+z*z<1.1f || Ground(x,z)<-.08f) continue;
                var size=Random(.025f,.11f);
                Boulder(Grounded(x,z),new(size,size*.35f,size*.7f),C(i%3==0 ? "#C4B3A8":"#E1C69F"),i,1);
            }
            var rocks = new[]{new Vector3(3.6f,0,-3.4f),new Vector3(4.4f,0,-3.8f),new Vector3(-4.1f,0,-3.6f),new Vector3(-5.4f,0,-4.3f)};
            for(var i=0;i<rocks.Length;i++)
            {
                var p=rocks[i]; p.y=Ground(p.x,p.z)+.15f;
                Boulder(p,new Vector3(.85f,.65f,.7f)*(1+i*.12f),C("#8891AC"),i*39,1);
                Boulder(p+new Vector3(.7f,-.18f,.4f),new(.4f,.33f,.45f),C("#A2A9BC"),i*15,1);
            }
            FloatLeaf(Grounded(2.3f,-2.1f),.85f,.48f);
            FloatLeaf(Grounded(2.85f,-2.35f),1.1f,.58f);
            FloatLeaf(Grounded(3.35f,-2.15f),.68f,.35f);
            Flower(Grounded(2.0f,-1.7f),.28f,62);
            Dock(new Vector3(-2.8f,-.02f,-5.1f));
            // Asymmetric headlands and waterfall landmarks are actual meshes.
            CliffIsland(new Vector3(8.4f,Sea,-36),new Vector3(6.5f,6.7f,4.8f),31);
            CliffIsland(new Vector3(-16.0f,Sea,-43),new Vector3(6.4f,3.6f,4.2f),73);
            CliffIsland(new Vector3(-2,Sea,-62),new Vector3(4.6f,1.8f,3),47);
            CliffIsland(new Vector3(22,Sea,-54),new Vector3(9,5,4.5f),92);
            // Cloud banks use smooth analytical normals, not faceted pancakes.
            Cloud(new Vector3(-15,6.5f,-53),new Vector3(13,5.2f,3.6f),12);
            Cloud(new Vector3(17,8.0f,-60),new Vector3(14,6.4f,4),37);
            Cloud(new Vector3(1,5.2f,-65),new Vector3(9,3.6f,3),57);
            Cloud(new Vector3(-30,5.9f,-65),new Vector3(9,2.1f,2),84);
            Cloud(new Vector3(34,5.5f,-65),new Vector3(10,2.7f,2),16);
            Cloud(new Vector3(-4,12,-73),new Vector3(9,2.8f,3),103);
        }

        private void BuildWater()
        {
            // The dense near-water grid is authored once. Runtime only displaces it.
            const int nx=160,nz=144;
            Vector3 P(int x,int z)=>new(-24+x*48f/nx,Sea,-32+z*44f/nz);
            for(var z=0;z<nz;z++) for(var x=0;x<nx;x++)
                _water.Quad(P(x,z),P(x,z+1),P(x+1,z+1),P(x+1,z),Color.white);
            _water.Quad(new(-180,Sea,80),new(180,Sea,80),new(180,Sea,12),new(-180,Sea,12),Color.white);
            _water.Quad(new(-180,Sea,-32),new(180,Sea,-32),new(180,Sea,-180),new(-180,Sea,-180),Color.white);
            _water.Quad(new(-180,Sea,12),new(-24,Sea,12),new(-24,Sea,-32),new(-180,Sea,-32),Color.white);
            _water.Quad(new(24,Sea,12),new(180,Sea,12),new(180,Sea,-32),new(24,Sea,-32),Color.white);
        }

        private void Boulder(Vector3 center,Vector3 size,Color color,int seed,int surface)
        {
            const int sides=13,rings=7;
            var phase=seed*.72f;
            Vector3 Point(int r,int s)
            {
                var a=s*Mathf.PI*2/sides+phase; var b=-Mathf.PI*.5f+r*Mathf.PI/rings;
                var radius=Mathf.Cos(b)*(1+.08f*Mathf.Sin(a*5+seed)+.04f*Mathf.Sin(a*9));
                return center+Vector3.Scale(size,new Vector3(radius*Mathf.Cos(a),Mathf.Sin(b),radius*Mathf.Sin(a)));
            }
            Vector3 Normal(Vector3 p)=>new Vector3((p.x-center.x)/size.x,(p.y-center.y)/size.y,(p.z-center.z)/size.z).normalized;
            for(var r=0;r<rings;r++) for(var s=0;s<sides;s++)
            {
                var a=Point(r,s); var b=Point(r+1,s); var c=Point(r+1,s+1); var d=Point(r,s+1);
                var tint=Color.Lerp(color*.92f,color*1.06f,Noise(s*.71f+seed,r*.6f));
                _land.SmoothQuad(a,b,c,d,Normal(a),Normal(b),Normal(c),Normal(d),tint,surface);
            }
        }

        private void CliffIsland(Vector3 origin,Vector3 size,int seed)
        {
            // Art-directed ridge and cliff field, baked offline. A broad sloping
            // crown connects the outcrops instead of exposing stacked primitives.
            float Crown(float x,float z)
            {
                var u=x/size.x; var v=z/size.z;
                var ridge=.88f-.30f*Mathf.Abs(u+.20f)-.20f*Mathf.Abs(v+.20f);
                ridge+=.055f*Mathf.Sin(u*7+seed);
                return size.y*ridge+.16f*(Noise(x*.55f+seed,z*.55f)-.5f);
            }
            float Field(Vector3 p)
            {
                var q=p+new Vector3(.12f*Mathf.Sin(p.y*.85f+seed),0,.07f*Mathf.Sin(p.y*1.2f));
                var u=q.x/size.x; var v=q.z/size.z;
                var angle=Mathf.Atan2(v,u);
                var radial=Mathf.Sqrt(u*u+v*v);
                var height=Mathf.Clamp01(p.y/size.y);
                var outline=.88f+.09f*Mathf.Sin(angle*3+seed)+.05f*Mathf.Cos(angle*7+seed*.4f);
                // Two discontinuous bedding shelves, tilted and broken by gullies.
                var ledge=.21f*Mathf.SmoothStep(0,1,Mathf.InverseLerp(.24f,.29f,height+u*.22f))
                    *Mathf.SmoothStep(0,1,Mathf.InverseLerp(-.6f,.65f,Mathf.Cos(angle*2+seed)));
                var gully=Mathf.Pow(Mathf.Max(0,Mathf.Cos(angle*9+height*.6f+seed)),14)*.075f;
                var side=(radial-outline+height*.09f+ledge+gully)*Mathf.Min(size.x,size.z);
                var crown=p.y-Crown(p.x,p.z);
                var shape=-SmoothMinimum(-side,-crown,.24f);
                return Mathf.Max(shape,-p.y-.75f);
            }
            var rockLow=C("#64758A"); var rockHigh=C("#B6B7AC");
            var grassDark=C("#55934B"); var grassLight=C("#A8CA63");
            var crevice=C("#7E8DAA");
            Color Tint(Vector3 p,Vector3 n)
            {
                var foliage=Mathf.SmoothStep(0,1,Mathf.InverseLerp(.45f,.77f,n.y))
                    *Mathf.SmoothStep(0,1,Mathf.InverseLerp(.12f,.5f,p.y));
                var rock=Color.Lerp(rockLow,rockHigh,Mathf.Clamp01(p.y/size.y));
                var grass=Color.Lerp(grassDark,grassLight,Noise(p.x*.65f,p.z*.65f));
                // Bake broad crevice occlusion into vertex paint, independent of
                // runtime SSAO. This gives overlaps depth without realistic texture noise.
                var cavity=Mathf.Clamp01((.3f-Field(p+n*.3f))/.3f)*.4f
                    +Mathf.Clamp01((.8f-Field(p+n*.8f))/.8f)*.25f;
                var color=Color.Lerp(rock,grass,foliage);
                return Color.Lerp(color,color*crevice,cavity);
            }
            // Offline production resolution; this sampling never runs in the Player.
            var near=origin.z>-45;
            Polygonize(_land,origin,new Vector3(-size.x*1.15f,-.9f,-size.z*1.15f),
                new Vector3(size.x*2.3f,size.y*1.3f+1.2f,size.z*2.3f),near?112:64,near?84:44,near?80:44,Field,Tint,1);
            float Height(float x,float z)
            {
                var bottom=-.4f; var top=size.y*1.3f;
                if(Field(new Vector3(x,bottom,z))>0) return 0;
                for(var i=0;i<18;i++)
                {
                    var mid=(bottom+top)*.5f;
                    if(Field(new Vector3(x,mid,z))<0) bottom=mid; else top=mid;
                }
                return (bottom+top)*.5f;
            }
            var planted=new List<Vector2>();
            for(var i=0;i<180 && planted.Count<24;i++)
            {
                var x=Random(-size.x*.7f,size.x*.7f); var z=Random(-size.z*.65f,size.z*.65f);
                var h=Height(x,z); var p=origin+new Vector3(x,h,z);
                if(h<size.y*.25f || Mathf.Abs(Height(x+.15f,z)-h)>.16f || Mathf.Abs(Height(x,z+.15f)-h)>.16f
                    || planted.Exists(v=>(v-new Vector2(x,z)).sqrMagnitude<.5f)) continue;
                planted.Add(new Vector2(x,z));
                CanopyTree(p,Random(.48f,.90f),seed+i*31);
            }
            if(seed==73) Arch(origin+new Vector3(0,Height(0,0),0),1.8f,1.5f);
            if(seed==31) Cascade(origin,size,Field,Height(-size.x*.13f,0),-size.x*.13f,.48f);
        }
        private static float SmoothMinimum(float a,float b,float radius)
        {
            var h=Mathf.Max(radius-Mathf.Abs(a-b),0)/radius;
            return Mathf.Min(a,b)-h*h*radius*.25f;
        }
        private void Cascade(Vector3 origin,Vector3 size,Func<Vector3,float> field,float height,float x,float width)
        {
            const int steps=100;
            Vector3 Point(float t,float side)
            {
                var y=Mathf.Lerp(height-.08f,.04f,t);
                var px=x+Mathf.Sin(t*5)*.08f+side*width;
                var z=size.z*1.25f;
                // Find the outermost cliff surface at this elevation; follow shelves
                // as well as vertical faces without intersecting the rock mesh.
                for(var i=0;i<100;i++)
                {
                    var back=z-size.z*.025f;
                    if(field(new Vector3(px,y,back))<=0)
                    {
                        var front=z;
                        for(var j=0;j<10;j++)
                        {
                            var middle=(front+back)*.5f;
                            if(field(new Vector3(px,y,middle))>0) front=middle; else back=middle;
                        }
                        z=(front+back)*.5f; break;
                    }
                    z=back;
                }
                return origin+new Vector3(px,y,z+.14f);
            }
            for(var i=0;i<steps;i++)
            {
                var t=i/(float)steps; var u=(i+1)/(float)steps;
                _land.Quad(Point(t,-.5f),Point(t,.5f),Point(u,.5f),Point(u,-.5f),C("#BCF5F2"),7);
            }
            var foot=Point(1,0);
            for(var i=0;i<7;i++) Ellipsoid(_clouds,foot+new Vector3(Random(-width,width),.04f,Random(-.25f,.25f)),new(.23f,.1f,.18f),C("#E6FCF6"),0,12,8);
        }

        private void Palm(Vector3 origin,float height,float bend,int seed)
        {
            var top=origin;
            for(var i=1;i<=16;i++)
            {
                var t=i/16f; var p=origin+new Vector3(bend*t*t,height*t,.1f*Mathf.Sin(t*3));
                Tube(_land,top,p,Mathf.Lerp(.115f,.055f,t),C("#BD9879"),10,2);
                if(i<16) Tube(_land,p-Vector3.up*.025f,p,Mathf.Lerp(.12f,.06f,t),C("#8F786B"),10,2);
                top=p;
            }
            for(var i=0;i<11;i++)
            {
                var angle=(seed+i*360f/11)*Mathf.Deg2Rad;
                Frond(top,new Vector3(Mathf.Cos(angle),0,Mathf.Sin(angle)),height*(.43f+.04f*(i%3)),i);
            }
            for(var i=0;i<3;i++) Boulder(top+new Vector3((i-1)*.11f,-.13f,.06f),new(.11f,.15f,.12f),C("#877552"),seed+i,2);
        }

        private void Frond(Vector3 origin,Vector3 direction,float length,int seed)
        {
            var side=Vector3.Cross(Vector3.up,direction);
            Vector3 Spine(float t)=>origin+direction*length*t+Vector3.up*(Mathf.Sin(t*Mathf.PI)*length*.18f-t*t*length*.23f);
            // Continuous curved leaf ribbon with subtle serrated edges and a central rib.
            for(var i=0;i<24;i++)
            {
                var t=i/24f; var u=(i+1)/24f;
                float Width(float v)=>Mathf.Pow(Mathf.Sin(v*Mathf.PI),.75f)*length*.035f;
                var a=Spine(t); var b=Spine(u); var wa=Width(t); var wb=Width(u);
                var left=C(seed%3==0 ? "#C2D85C":"#9EC94E"); var right=C(seed%3==0 ? "#83B553":"#64A55B");
                var normal=Vector3.up*.8f-direction*.2f;
                _leaves.LeafQuad(a,a+side*wa-Vector3.up*wa*.3f,b+side*wb-Vector3.up*wb*.3f,b,normal,left,t,u);
                _leaves.LeafQuad(a,b,b-side*wb-Vector3.up*wb*.3f,a-side*wa-Vector3.up*wa*.3f,normal,right,t,u);
                if(i%3==0) Tube(_leaves,a,b,.009f,C("#D8E586"),4,0,t);
            }
            for(var i=1;i<15;i++) foreach(var sign in new[]{-1,1})
            {
                var t=i/16f; var reach=Mathf.Sin(t*Mathf.PI)*length*.21f;
                var tip=Spine(Mathf.Min(1,t+.10f))+side*sign*reach-Vector3.up*reach*.24f;
                Leaf(Spine(t),tip,length*.025f,C(i%3==0 ? "#B6CC69":"#78A859"));
            }
        }

        private void Leaf(Vector3 origin,Vector3 end,float width,Color color)
        {
            var direction=end-origin; var side=Vector3.Cross(direction.normalized,Vector3.up).normalized;
            if(side.sqrMagnitude<.1f) side=Vector3.right;
            for(var i=0;i<7;i++)
            {
                var t=i/7f; var u=(i+1)/7f;
                Vector3 Spine(float v)=>Vector3.Lerp(origin,end,v)+Vector3.up*Mathf.Sin(v*Mathf.PI)*width*.4f;
                var a=Spine(t); var b=Spine(u);
                var wa=Mathf.Sin(t*Mathf.PI)*width; var wb=Mathf.Sin(u*Mathf.PI)*width;
                var normal=(Vector3.up*.75f-direction.normalized*.25f).normalized;
                _leaves.LeafQuad(a,a+side*wa,b+side*wb,b,normal,color,t,u);
                _leaves.LeafQuad(a,b,b-side*wb,a-side*wa,normal,color*.88f,t,u);
            }
        }

        private void Shrub(Vector3 p,float size)
        {
            for(var i=0;i<9;i++)
            {
                var a=Random(0,Mathf.PI*2); var h=size*Random(.6f,1.25f);
                var direction=new Vector3(Mathf.Cos(a),.2f,Mathf.Sin(a));
                var tip=p+direction*size*.45f+Vector3.up*h;
                Tube(_leaves,p,tip,.005f,C("#73804A"),4,0,.15f);
                for(var pair=1;pair<5;pair++) foreach(var sign in new[]{-1,1})
                {
                    var start=Vector3.Lerp(p,tip,pair/5f);
                    var side=Vector3.Cross(Vector3.up,direction)*sign;
                    var end=start+(side*.85f+direction*.3f+Vector3.up*.20f)*size*.30f;
                    var normal=(Vector3.up+side*.35f).normalized;
                    var width=size*.065f;
                    var center=(start+end)*.5f+normal*width*.3f;
                    var tangent=Vector3.Cross(normal,end-start).normalized*width;
                    var color=C(pair>2 ? "#A8C55C":"#598E50");
                    _leaves.SmoothTriangle(start,center+tangent,end,normal,normal,normal,color,8,.5f);
                    _leaves.SmoothTriangle(start,end,center-tangent,normal,normal,normal,color*.92f,8,.5f);
                }
            }
        }
        private void Fern(Vector3 p,float size)
        {
            for(var branch=0;branch<5;branch++)
            {
                var angle=Random(0,Mathf.PI*2);
                var direction=new Vector3(Mathf.Cos(angle),0,Mathf.Sin(angle));
                var side=Vector3.Cross(Vector3.up,direction);
                Vector3 Spine(float t)=>p+direction*size*t+Vector3.up*size*(Mathf.Sin(t*2.1f)*.65f+.08f);
                for(var i=1;i<11;i++)
                {
                    var t=i/12f; var a=Spine(t); var b=Spine(t+.08f);
                    Tube(_leaves,a,b,.006f,C("#8CA35E"),4,0,t);
                    foreach(var sign in new[]{-1,1}) Leaf(a,b+side*sign*size*.22f*Mathf.Sin(t*Mathf.PI),size*.025f,C(i%2==0 ? "#6AA36D":"#95BC74"));
                }
            }
        }
        private void Grass(Vector3 p,float size,int seed)
        {
            for(var i=0;i<4;i++)
            {
                var a=(seed+i*90)*Mathf.Deg2Rad;
                Leaf(p,p+new Vector3(Mathf.Cos(a)*size*.7f,size,Mathf.Sin(a)*size*.7f),size*.12f,C(i%2==0 ? "#C8DA6A":"#8DB754"));
            }
        }
        private void Flower(Vector3 p,float size,int seed)
        {
            var center=p+Vector3.up*size;
            Tube(_leaves,p,center,.014f,C("#60976B"),5,0);
            for(var i=0;i<5;i++)
            {
                var angle=(i*72+seed)*Mathf.Deg2Rad;
                var direction=new Vector3(Mathf.Cos(angle),.35f,Mathf.Sin(angle));
                var side=Vector3.Cross(Vector3.up,direction).normalized;
                var mid=center+direction*size*.65f;
                var tip=center+direction*size;
                _leaves.Quad(center,mid+side*size*.32f,tip,mid-side*size*.32f,C(seed%2==0 ? "#EF8992":"#F6E7A7"),4);
            }
            Ellipsoid(_leaves,center+Vector3.up*.03f,Vector3.one*size*.19f,C("#F9C76D"),4,8,5);
        }
        private void FloatLeaf(Vector3 p,float height,float radius)
        {
            var top=p+new Vector3(.09f,height,0);
            Tube(_leaves,p,top,.018f,C("#77B777"),6,0);
            const int sides=32;
            var center=top+Vector3.up*.1f;
            for(var i=0;i<sides;i++)
            {
                Vector3 Edge(int n) { var a=n*Mathf.PI*2/sides; return top+new Vector3(Mathf.Cos(a)*radius,Mathf.Sin(a*5)*.025f,Mathf.Sin(a)*radius*.65f); }
                var a=Edge(i); var b=Edge(i+1);
                _leaves.SmoothTriangle(center,b,a,Vector3.up,Vector3.up,Vector3.up,C(i%4==0 ? "#91E3D4":"#60CFC2"),6);
                Tube(_leaves,a,b,.009f,C("#D5F9DD"),4,6);
                if(i%4==0) Tube(_leaves,center,a,.006f,C("#D5F9DD"),4,6);
            }
        }

        private void Dock(Vector3 origin)
        {
            for(var i=0;i<19;i++)
            {
                var p=origin+new Vector3(Mathf.Sin(i*13)*.025f,.13f,-i*.25f);
                Box(p,new Vector3(1.18f,.09f,.225f),C(i%3==0 ? "#BE9578":"#D1AE88"),2,Quaternion.Euler(0,Mathf.Sin(i)*1.2f,0));
                foreach(var side in new[]{-1,1})
                    Ellipsoid(_land,p+new Vector3(side*.47f,.047f,0),new(.012f,.003f,.012f),C("#777B7B"),2,6,4);
            }
            for(var i=0;i<4;i++) foreach(var side in new[]{-1,1})
            {
                var p=origin+new Vector3(side*.64f,0,-i*1.45f);
                Tube(_land,p-Vector3.up*.7f,p+Vector3.up*.68f,.055f,C("#9F7C65"),10,2);
                for(var j=0;j<3;j++) Tube(_land,p+Vector3.up*(.51f+j*.028f),p+Vector3.up*(.53f+j*.028f),.066f,C("#E8D3AC"),10,3);
                if(i<3) for(var j=0;j<10;j++)
                {
                    Vector3 Rope(float t)=>p+new Vector3(0,.55f-Mathf.Sin(t*Mathf.PI)*.16f,-t*1.45f);
                    Tube(_land,Rope(j/10f),Rope((j+1)/10f),.015f,C("#DDC9A4"),5,3);
                }
            }
            // Modest warm lanterns and a folded sail are scenery, not interactables.
            Lantern(origin+new Vector3(-.64f,.65f,-1.45f));
            Lantern(origin+new Vector3(.64f,.65f,-4.35f));
        }
        private void Lantern(Vector3 p)
        {
            Box(p+Vector3.up*.12f,new(.13f,.19f,.13f),C("#FFE4A5"),6);
            Box(p+Vector3.up*.23f,new(.18f,.035f,.18f),C("#776F72"),2);
            Box(p+Vector3.up*.015f,new(.15f,.03f,.15f),C("#776F72"),2);
            foreach(var x in new[]{-.065f,.065f}) foreach(var z in new[]{-.065f,.065f})
                Tube(_land,p+new Vector3(x,.03f,z),p+new Vector3(x,.22f,z),.008f,C("#776F72"),4,2);
        }
        private void Arch(Vector3 p,float width,float height)
        {
            var color=C("#DCD9BC"); var radius=width*.5f;
            foreach(var side in new[]{-1,1})
            {
                for(var i=0;i<5;i++) Box(p+new Vector3(side*radius,(i+.5f)*height*.11f,0),new(.35f,height*.105f,.42f),color,1);
                Box(p+new Vector3(side*radius,height*.55f,0),new(.48f,.12f,.52f),color,1);
            }
            for(var i=0;i<15;i++)
            {
                var a=(i+.5f)*Mathf.PI/15;
                Box(p+new Vector3(Mathf.Cos(a)*radius,height*.55f+Mathf.Sin(a)*radius,0),new(.29f,.36f,.42f),color,1,Quaternion.Euler(0,0,a*Mathf.Rad2Deg-90));
            }
        }
        private void CanopyTree(Vector3 p,float size,int seed)
        {
            var random=new System.Random(seed);
            float R(float low,float high)=>Mathf.Lerp(low,high,(float)random.NextDouble());
            var top=p+Vector3.up*size;
            Tube(_land,p,top,.045f*size,C("#77765F"),8,2);
            for(var branch=0;branch<8;branch++)
            {
                var angle=(branch*137.5f+seed)*Mathf.Deg2Rad;
                var crown=top+new Vector3(Mathf.Cos(angle)*R(.15f,.57f),R(-.05f,.45f),Mathf.Sin(angle)*R(.15f,.57f))*size;
                Tube(_land,p+Vector3.up*size*.55f,crown,.018f*size,C("#77765F"),5,2);
                for(var i=0;i<28;i++)
                {
                    var azimuth=R(0,Mathf.PI*2); var y=R(-1,1);
                    var radial=Mathf.Sqrt(1-y*y); var normal=new Vector3(radial*Mathf.Cos(azimuth),y,radial*Mathf.Sin(azimuth));
                    var center=crown+Vector3.Scale(normal,new Vector3(.37f,.25f,.34f))*size*R(.70f,1);
                    var up=(normal+Vector3.up*.85f).normalized;
                    var right=Vector3.Cross(up,Vector3.forward).normalized;
                    if(right.sqrMagnitude<.01f) right=Vector3.right;
                    var forward=Vector3.Cross(right,up).normalized;
                    var length=R(.20f,.30f)*size; var width=length;
                    var color=Color.Lerp(C("#396C4C"),C("#9FBD59"),Mathf.Clamp01(.42f+normal.y*.36f+R(-.15f,.15f)));
                    _leaves.LeafCard(center,forward*length,right*width,up,color);
                }
            }
        }
        private void Cloud(Vector3 center,Vector3 size,int seed)
        {
            // A smooth union field is polygonised into one continuous cloud mesh.
            // Six tetrahedra per voxel avoid the ambiguous marching-cubes cases.
            var random=new System.Random(seed);
            var centers=new Vector3[12]; var radii=new Vector3[12];
            for(var i=0;i<centers.Length;i++)
            {
                var t=i/11f; var bell=Mathf.Sin(t*Mathf.PI);
                centers[i]=new Vector3((t-.5f)*size.x,bell*size.y*.19f+(float)random.NextDouble()*size.y*.30f,(float)random.NextDouble()*size.z*.5f);
                var r=.55f+(float)random.NextDouble()*.6f;
                radii[i]=new Vector3(size.x*.13f,size.y*(.16f+bell*.28f),size.z*.6f)*r;
            }
            float Field(Vector3 p)
            {
                var value=100f;
                for(var i=0;i<centers.Length;i++)
                {
                    var q=p-centers[i]; var r=radii[i];
                    var d=(new Vector3(q.x/r.x,q.y/r.y,q.z/r.z).magnitude-1)*Mathf.Min(r.x,r.y,r.z);
                    const float blend=.32f;
                    var h=Mathf.Clamp01(.5f+.5f*(d-value)/blend);
                    value=Mathf.Lerp(d,value,h)-blend*h*(1-h);
                }
                var billow=Noise(p.x*2.1f+seed,p.y*2.1f+p.z*.4f)*.65f+Noise(p.x*4.7f,p.y*4.7f+p.z*.8f)*.35f;
                return value+(billow-.5f)*.20f;
            }
            var min=new Vector3(-size.x*.75f,-size.y*.62f,-size.z);
            var extent=new Vector3(size.x*1.5f,size.y*1.65f,size.z*2.2f);
            var color=C("#FFF9ED");
            Polygonize(_clouds,center,min,extent,64,40,24,Field,(_,_)=>color,0);
        }
        private static void Polygonize(Geometry geometry,Vector3 center,Vector3 min,Vector3 extent,
            int nx,int ny,int nz,Func<Vector3,float> field,Func<Vector3,Vector3,Color> tint,int surface)
        {
            var points=new Vector3[(nx+1)*(ny+1)*(nz+1)];
            var values=new float[points.Length]; var normals=new Vector3[points.Length];
            int Index(int x,int y,int z)=>(z*(ny+1)+y)*(nx+1)+x;
            for(var z=0;z<=nz;z++) for(var y=0;y<=ny;y++) for(var x=0;x<=nx;x++)
            {
                var index=Index(x,y,z); points[index]=min+Vector3.Scale(extent,new Vector3(x/(float)nx,y/(float)ny,z/(float)nz));
                values[index]=field(points[index]);
            }
            for(var z=1;z<nz;z++) for(var y=1;y<ny;y++) for(var x=1;x<nx;x++)
                normals[Index(x,y,z)]=new Vector3((values[Index(x+1,y,z)]-values[Index(x-1,y,z)])*nx/extent.x,
                    (values[Index(x,y+1,z)]-values[Index(x,y-1,z)])*ny/extent.y,
                    (values[Index(x,y,z+1)]-values[Index(x,y,z-1)])*nz/extent.z).normalized;
            var cube=new int[8]; var inside=new int[4]; var outside=new int[4];
            var tetra=new[]{0,5,1,6, 0,1,2,6, 0,2,3,6, 0,3,7,6, 0,7,4,6, 0,4,5,6};
            (Vector3 p,Vector3 n) Edge(int a,int b)
            {
                var t=values[a]/(values[a]-values[b]);
                return (Vector3.Lerp(points[a],points[b],t),Vector3.Lerp(normals[a],normals[b],t).normalized);
            }
            void Triangle((Vector3 p,Vector3 n) a,(Vector3 p,Vector3 n) b,(Vector3 p,Vector3 n) c)
            {
                if(Vector3.Dot(Vector3.Cross(b.p-a.p,c.p-a.p),a.n+b.n+c.n)<0) (b,c)=(c,b);
                geometry.ColoredTriangle(center+a.p,center+b.p,center+c.p,a.n,b.n,c.n,
                    tint(a.p,a.n),tint(b.p,b.n),tint(c.p,c.n),surface);
            }
            for(var z=0;z<nz;z++) for(var y=0;y<ny;y++) for(var x=0;x<nx;x++)
            {
                cube[0]=Index(x,y,z); cube[1]=Index(x+1,y,z); cube[2]=Index(x+1,y+1,z); cube[3]=Index(x,y+1,z);
                cube[4]=Index(x,y,z+1); cube[5]=Index(x+1,y,z+1); cube[6]=Index(x+1,y+1,z+1); cube[7]=Index(x,y+1,z+1);
                for(var t=0;t<6;t++)
                {
                    var ni=0; var no=0;
                    for(var j=0;j<4;j++) { var k=cube[tetra[t*4+j]]; if(values[k]<0) inside[ni++]=k; else outside[no++]=k; }
                    if(ni==1) Triangle(Edge(inside[0],outside[0]),Edge(inside[0],outside[1]),Edge(inside[0],outside[2]));
                    else if(ni==3) Triangle(Edge(outside[0],inside[2]),Edge(outside[0],inside[1]),Edge(outside[0],inside[0]));
                    else if(ni==2)
                    {
                        var a=Edge(inside[0],outside[0]); var b=Edge(inside[0],outside[1]);
                        var c=Edge(inside[1],outside[1]); var d=Edge(inside[1],outside[0]);
                        Triangle(a,b,c); Triangle(a,c,d);
                    }
                }
            }
        }
        private static void Ellipsoid(Geometry geometry,Vector3 center,Vector3 size,Color color,int surface,int sides,int rings)
        {
            Vector3 Unit(int r,int s)
            {
                var a=s*Mathf.PI*2/sides; var b=r*Mathf.PI/rings-Mathf.PI*.5f;
                return new Vector3(Mathf.Cos(b)*Mathf.Cos(a),Mathf.Sin(b),Mathf.Cos(b)*Mathf.Sin(a));
            }
            for(var r=0;r<rings;r++) for(var s=0;s<sides;s++)
            {
                var a=Unit(r,s); var b=Unit(r+1,s); var c=Unit(r+1,s+1); var d=Unit(r,s+1);
                geometry.SmoothQuad(center+Vector3.Scale(a,size),center+Vector3.Scale(b,size),center+Vector3.Scale(c,size),center+Vector3.Scale(d,size),a,b,c,d,color,surface);
            }
        }
        private void Box(Vector3 center,Vector3 size,Color color,int surface,Quaternion? rotation=null)
        {
            var q=rotation??Quaternion.identity;
            Vector3 P(float x,float y,float z)=>center+q*Vector3.Scale(new Vector3(x,y,z)*.5f,size);
            _land.Quad(P(-1,-1,1),P(1,-1,1),P(1,1,1),P(-1,1,1),color,surface);
            _land.Quad(P(1,-1,-1),P(-1,-1,-1),P(-1,1,-1),P(1,1,-1),color,surface);
            _land.Quad(P(-1,-1,-1),P(-1,-1,1),P(-1,1,1),P(-1,1,-1),color,surface);
            _land.Quad(P(1,-1,1),P(1,-1,-1),P(1,1,-1),P(1,1,1),color,surface);
            _land.Quad(P(-1,1,1),P(1,1,1),P(1,1,-1),P(-1,1,-1),color,surface);
            _land.Quad(P(-1,-1,-1),P(1,-1,-1),P(1,-1,1),P(-1,-1,1),color,surface);
        }
        private static void Tube(Geometry geometry,Vector3 a,Vector3 b,float radius,Color color,int sides,int surface,float sway=0)
        {
            var direction=(b-a).normalized;
            var right=Vector3.Cross(direction,Mathf.Abs(direction.y)>.9f ? Vector3.forward:Vector3.up).normalized;
            var forward=Vector3.Cross(right,direction);
            Vector3 N(int i)=>right*Mathf.Cos(i*Mathf.PI*2/sides)+forward*Mathf.Sin(i*Mathf.PI*2/sides);
            for(var i=0;i<sides;i++)
            {
                geometry.SmoothQuad(a+N(i)*radius,b+N(i)*radius,b+N(i+1)*radius,a+N(i+1)*radius,N(i),N(i),N(i+1),N(i+1),color,surface,sway);
                geometry.Triangle(b,b+N(i)*radius,b+N(i+1)*radius,color,surface);
            }
        }
        private sealed class Geometry
        {
            internal readonly List<Vector3> Vertices=new();
            internal readonly List<Vector3> Normals=new();
            internal readonly List<Color32> Colors=new();
            // x: wind weight, y: material family, zw: leaf-local coordinates.
            internal readonly List<Vector4> Uvs=new();
            internal readonly List<int> Indices=new();
            private readonly Dictionary<(Vector3Int,Vector3Int,Color32,Vector4),int> _vertices=new();
            internal void Clear() { Vertices.Clear(); Normals.Clear(); Colors.Clear(); Uvs.Clear(); Indices.Clear(); _vertices.Clear(); }
            private void Vertex(Vector3 p,Vector3 n,Color color,Vector4 uv)
            {
                n.Normalize();
                // Weld numerically equivalent tetrahedron edges. Preserve separate
                // normals/UVs at actual hard edges, leaf folds and material boundaries.
                var positionKey=Vector3Int.RoundToInt(p*10000);
                var normalKey=Vector3Int.RoundToInt(n*10000);
                var packedColor=(Color32)color;
                var key=(positionKey,normalKey,packedColor,uv);
                if(!_vertices.TryGetValue(key,out var index))
                {
                    index=Vertices.Count; _vertices.Add(key,index);
                    Vertices.Add(p); Normals.Add(n); Colors.Add(packedColor); Uvs.Add(uv);
                }
                Indices.Add(index);
            }
            internal void Triangle(Vector3 a,Vector3 b,Vector3 c,Color color,int surface=0)
            { var n=Vector3.Cross(b-a,c-a).normalized; SmoothTriangle(a,b,c,n,n,n,color,surface); }
            internal void SmoothTriangle(Vector3 a,Vector3 b,Vector3 c,Vector3 na,Vector3 nb,Vector3 nc,Color color,int surface=0,float sway=0)
            { var uv=new Vector4(sway,surface,0,0); Vertex(a,na,color,uv); Vertex(b,nb,color,uv); Vertex(c,nc,color,uv); }
            internal void ColoredTriangle(Vector3 a,Vector3 b,Vector3 c,Vector3 na,Vector3 nb,Vector3 nc,Color ca,Color cb,Color cc,int surface)
            { var uv=new Vector4(0,surface,0,0); Vertex(a,na,ca,uv); Vertex(b,nb,cb,uv); Vertex(c,nc,cc,uv); }
            internal void Quad(Vector3 a,Vector3 b,Vector3 c,Vector3 d,Color color,int surface=0)
            { Triangle(a,b,c,color,surface); Triangle(a,c,d,color,surface); }
            internal void SmoothQuad(Vector3 a,Vector3 b,Vector3 c,Vector3 d,Vector3 na,Vector3 nb,Vector3 nc,Vector3 nd,Color color,int surface=0,float sway=0)
            { SmoothTriangle(a,b,c,na,nb,nc,color,surface,sway); SmoothTriangle(a,c,d,na,nc,nd,color,surface,sway); }
            internal void LeafQuad(Vector3 a,Vector3 b,Vector3 c,Vector3 d,Vector3 n,Color color,float t,float u)
            {
                Vertex(a,n,color,new(t,0,t,0)); Vertex(b,n,color,new(t,0,t,1)); Vertex(c,n,color,new(u,0,u,1));
                Vertex(a,n,color,new(t,0,t,0)); Vertex(c,n,color,new(u,0,u,1)); Vertex(d,n,color,new(u,0,u,0));
            }
            internal void LeafCard(Vector3 p,Vector3 forward,Vector3 right,Vector3 n,Color color)
            {
                var a=p-forward-right; var b=p-forward+right; var c=p+forward+right; var d=p+forward-right;
                Vertex(a,n,color,new(.5f,9,0,0)); Vertex(b,n,color,new(.5f,9,1,0)); Vertex(c,n,color,new(.5f,9,1,1));
                Vertex(a,n,color,new(.5f,9,0,0)); Vertex(c,n,color,new(.5f,9,1,1)); Vertex(d,n,color,new(.5f,9,0,1));
            }
        }
    }
}
