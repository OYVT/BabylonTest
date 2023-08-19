const canvas = document.getElementById("renderCanvas"); // Get the canvas element
const engine = new BABYLON.Engine(canvas, true, { stencil: true }); // Generate the BABYLON 3D engine

class VertexManipulator {
    constructor(scene) {
        // Initialize variables
        this.scene = scene;
        this.sphere = BABYLON.MeshBuilder.CreateSphere("sp",{diameter:0.2},this.scene);
        this.vertexSelectionRadius = 0.25;

        // Variables set at mesh selection
        this.selectedMesh = null;
        this.selectedMeshVertices = [];

        // Variables set at vertex selection
        this.selectedVertex = null;
        this.selectedSphere = null;
        this.pickOrigin = new BABYLON.Vector3();
        this.tmpVec = new BABYLON.Vector3();

        // Create gizmo manager
        this.gizmoManager = new BABYLON.GizmoManager(this.scene);
        this.gizmoManager.positionGizmoEnabled = true;
        this.gizmoManager.rotationGizmoEnabled = false;
        this.gizmoManager.scaleGizmoEnabled = false;
        this.gizmoManager.boundingBoxGizmoEnabled = false;

        // Create transform node
        this.tranny = new BABYLON.TransformNode("tranny",this.scene);
        this.gizmoManager.attachableMeshes = [this.tranny];

        // 
        this.gizmoManager.gizmos.positionGizmo.onDragEndObservable.add((e) => {
            const transformMesh = this.gizmoManager.gizmos.positionGizmo.attachedMesh;
            if(!this.selectedVertex)
                return;
            const delta = transformMesh.position.subtract(this.pickOrigin);
            this.selectedVertex.addInPlace(delta);
            this.selectedSphere.position.copyFrom(this.selectedVertex);
            this.pickOrigin.addInPlace(delta);
            this.updateVertices(this.selectedMesh);
        })   
    }

    selectMesh(mesh){
        this.selectedMesh = mesh;
        this.selectedMesh.isPickable = true;
        const positions = this.selectedMesh.getVerticesData(BABYLON.VertexBuffer.PositionKind);
        this.selectedMeshVertices = [];
        for(let i=0;i<positions.length;i+=3){
            this.selectedMeshVertices.push(new BABYLON.Vector3(
                positions[i],
                positions[i+1],
                positions[i+2]))
        };
    }

    clearMeshSelection(){
        if (!this.selectedMesh)
            return;
        this.selectedMesh.isPickable = false;
        this.selectedMesh = null;
        this.selectedMeshVertices = [];
        this.clearVertexSelection();
    }

    clearVertexSelection(){
        if (!this.selectedVertex)
            return;
        this.selectedVertex = null;
        if (this.selectedSphere) {
            this.selectedSphere.dispose();
            this.selectedSphere = null;
        }
        this.gizmoManager.attachToMesh(null);
    }

    updateVertices(){
        if (!this.selectedVertex)
            return;
        if (!this.selectedMesh)
            return;
        const positions = [];
        this.selectedMeshVertices.forEach((vertex) => {
            positions.push(vertex.x,vertex.y,vertex.z);
        });
        this.selectedMesh.updateVerticesData(BABYLON.VertexBuffer.PositionKind, positions);
        this.selectedMesh.bakeCurrentTransformIntoVertices();
    }

    selectVertex(hit) {
        // Reset
        this.clearVertexSelection();

        // Find closest vertex
        let selectedVertexDistance = Number.MAX_VALUE;
        const selectedMeshWorldMatrix = this.selectedMesh.getWorldMatrix();
        this.selectedMeshVertices.forEach((vertex) => {
            BABYLON.Vector3.TransformCoordinatesToRef(vertex,selectedMeshWorldMatrix,this.tmpVec);
            const distance = BABYLON.Vector3.Distance(this.tmpVec,hit.pickedPoint);
            if (distance < this.vertexSelectionRadius && distance < selectedVertexDistance) {
                this.selectedVertex = vertex;
                selectedVertexDistance = distance;
            }
        });

        if (!this.selectVertex) 
            return;
        
        // Create sphere at selected vertex
        this.selectedSphere = this.sphere.createInstance("spi");
        this.selectedSphere.position.copyFrom(this.selectedVertex);
        
        // Attach gizmo to selected vertex
        this.tranny.position.copyFrom(this.selectedVertex);
        this.gizmoManager.attachToMesh(this.tranny);
        this.pickOrigin.copyFrom(this.selectedVertex);
    }

}

// Add your code here matching the playground format
const createScene = function () {
    const scene = new BABYLON.Scene(engine);

    const shapres2D = [];

    //#region Camera & Light
    const camera = new BABYLON.ArcRotateCamera("Camera", -Math.PI / 2, Math.PI / 4, 10, BABYLON.Vector3.Zero());
    camera.inputs.attached.mousewheel.wheelPrecision = 50;
    camera.attachControl(canvas, true);
    const light = new BABYLON.HemisphericLight("light", new BABYLON.Vector3(1, 1, 0));
    //#endregion

    //#region Ground & Grid
    const ground = BABYLON.MeshBuilder.CreateGround("ground", {
        height: 20, 
        width: 30, 
        subdivisions: 1
    });
    ground.position.y = -0.001;
    // Grid reference: https://doc.babylonjs.com/toolsAndResources/assetLibraries/materialsLibrary/gridMat
    const grid = new BABYLON.GridMaterial("groundMaterial", scene);
    grid.gridRatio = 1; // 1: 1 gird per unit | 0.1: 10 grid per unit
    grid.majorUnitFrequency = 5; // Grid major line frequency
    //grid.opacity = 0.5; // Grid opacity
    //grid.minorUnitVisibility = 0.2; // Grid minor lines visibility
    //grid.lineColor = new BABYLON.Color3.Red(); // Grid lines color
    //grid.mainColor = new BABYLON.Color3.Blue(); // Grid background color
    ground.material = grid;
    //#endregion

    const vertexManipulator = new VertexManipulator(scene);

    scene.onPointerObservable.add((evt) => {
        switch (evt.type) {
            case BABYLON.PointerEventTypes.POINTERDOWN:
                if (evt.event.button === 2) {
                    var ray = scene.createPickingRay(scene.pointerX, scene.pointerY, BABYLON.Matrix.Identity(), camera);
                    var hit = scene.pickWithRay(ray);
                    console.log("hit: ", hit);
                    if (hit.pickedMesh && shapres2D.includes(hit.pickedMesh)) {
                        vertexManipulator.selectVertex(hit);
                    }
                }
            break;
        }
    });

    // ground.actionManager = new BABYLON.ActionManager(scene);
    // ground.actionManager.registerAction(
    //     new BABYLON.ExecuteCodeAction(
    //         BABYLON.ActionManager.OnPickTrigger,
    //         function (event) {
    //             //event.additionalData.pickedPoint.x;
    //             //event.additionalData.pickedPoint.z;
    //             const shape = shapres2D[0];

    //             // Reference: https://doc.babylonjs.com/features/featuresDeepDive/mesh/creation/custom/updatingVertices
    //             const vertices = shape.getVerticesData(BABYLON.VertexBuffer.PositionKind);

    //             // Faield attempt to add additional vertex
    //             const vertices2 = new Float32Array([...vertices, 2, 0, -3]);

    //             // Attempt to add vertices
    //             /*let colors = [];            
    //             for(let p = 0; p < vertices2.length / 3; p++) {
    //             colors.push(Math.random(), Math.random(), Math.random(), 1);
    //             }
    //             shape.setVerticesData(BABYLON.VertexBuffer.ColorKind, colors);
    //             shape.setVerticesData(BABYLON.VertexBuffer.PositionKind, vertices2, true);
    //             //shape.updateVerticesData(BABYLON.VertexBuffer.PositionKind, vertices2, true);*/

    //             var numberOfVertices = vertices.length / 3;
    //             for (var i = 0; i < numberOfVertices; i++) {
    //                 vertices[i*3] = vertices[i*3] * 2;
    //                 vertices[i*3+1] = vertices[i*3+1] * 2;
    //                 vertices[i*3+2] = vertices[i*3+2] * 2;
    //             }
    //             shape.updateVerticesData(BABYLON.VertexBuffer.PositionKind, vertices, true);
    //         }
    //     )
    // );

    const sphere = BABYLON.MeshBuilder.CreateSphere("sphere", {diameter: 2, segments: 32}, scene);

    //#region GUI Panel
    const advancedTexture = BABYLON.GUI.AdvancedDynamicTexture.CreateFullscreenUI("GUI");
    const panel = new BABYLON.GUI.StackPanel();
    panel.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
    panel.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
    advancedTexture.addControl(panel);
    //#endregion

    //#region Button 2D
    var button2D = BABYLON.GUI.Button.CreateSimpleButton("button2D", "Top View");
    button2D.width = "150px"
    button2D.height = "40px";
    button2D.color = "white";
    button2D.cornerRadius = 20;
    button2D.background = "green";
    button2D.onPointerUpObservable.add(function() {
        camera.position = new BABYLON.Vector3(0, 10 /*y*/, 0);
    });
    panel.addControl(button2D);
    //#endregion  

    //#region Button Disc
    var buttonDisc = BABYLON.GUI.Button.CreateSimpleButton("buttonDisc", "Add disc");
    buttonDisc.width = "150px"
    buttonDisc.height = "40px";
    buttonDisc.color = "white";
    buttonDisc.cornerRadius = 20;
    buttonDisc.background = "green";
    buttonDisc.onPointerUpObservable.add(function() {
        const disc = BABYLON.MeshBuilder.CreateDisc("disc", {
        radius: 2, 
        tessellation: 6,
        sideOrientation: BABYLON.Mesh.DOUBLESIDE,
        updatable: true
        }, scene);
        disc.rotation.x = Math.PI / 2;
        shapres2D.push(disc);
    });
    panel.addControl(buttonDisc);
    //#endregion
  
    //#region Button Polygon
    var buttonPolygon = BABYLON.GUI.Button.CreateSimpleButton("buttonPolygon", "Add Polygon");
    buttonPolygon.width = "150px"
    buttonPolygon.height = "40px";
    buttonPolygon.color = "white";
    buttonPolygon.cornerRadius = 20;
    buttonPolygon.background = "green";
    panel.addControl(buttonPolygon);

    buttonPolygon.onPointerUpObservable.add(function() {
        //Polygon shape in XoZ plane
        const shape = [ 
            new BABYLON.Vector3(4, 0, -4), 
            new BABYLON.Vector3(2, 0, 0), 
            new BABYLON.Vector3(5, 0, 2), 
            new BABYLON.Vector3(1, 0, 2), 
            new BABYLON.Vector3(-5, 0, 5), 
            new BABYLON.Vector3(-3, 0, 1), 
            new BABYLON.Vector3(-4, 0, -4), 
            new BABYLON.Vector3(-2, 0, -3), 
            //new BABYLON.Vector3(2, 0, -3)
        ];
        
        //Holes in XoZ plane
        const holes = [];
        /*holes[0] = [ 
            new BABYLON.Vector3(1, 0, -1),
            new BABYLON.Vector3(1.5, 0, 0),
            new BABYLON.Vector3(1.4, 0, 1),
            new BABYLON.Vector3(0.5, 0, 1.5)
        ];
        holes[1] = [ 
            new BABYLON.Vector3(0, 0, -2),
            new BABYLON.Vector3(0.5, 0, -1),
            new BABYLON.Vector3(0.4, 0, 0),
            new BABYLON.Vector3(-1.5, 0, 0.5)
        ];*/
        
        const polygon = BABYLON.MeshBuilder.CreatePolygon("polygon", {
            shape: shape, 
            holes: holes, 
            sideOrientation: BABYLON.Mesh.SINGLESIDE,
            updatable: true
        });
        shapres2D.push(polygon);
        vertexManipulator.selectMesh(polygon);
    });
    //#endregion


    
    return scene;
};

const scene = createScene(); //Call the createScene function

// Register a render loop to repeatedly render the scene
engine.runRenderLoop(function () {
  scene.render();
});

// Watch for browser/canvas resize events
window.addEventListener("resize", function () {
  engine.resize();
});


