const canvas = document.getElementById("renderCanvas"); // Get the canvas element
const engine = new BABYLON.Engine(canvas, true, { stencil: true }); // Generate the BABYLON 3D engine

const minLayerOffset = 0.001;

// TODOs:
// Improve snap to vertex to use intersection with stock
// Implement rectangular shape with smaller base than top
// Grid needs work
// Snap to grid
// Add units
// Add undo/redo

class XactFitBuilder {

    //#region Scene properties
    #canvas = null;
    #scene = null;
    #camera = null;
    //#endregion

    //#region Ground properties
    #ground = null;
    #groundMaterial = null;
    //#endregion
    
    //#region Grid properties
    #gridMaterial = null;
    //#endregion

    //#region Body properties
    #body = null;
    #bodyMaterial = null;
    #bodyHeight = 0;
    #bodyWidth = 0;
    #bodyDepth = 0;
    //#endregion

    //#region Shapes properties
    #shapes = [];
    #shapesMaterial = null;
    #shapeActionManager = null;
    //#endregion

    //#region Shape drag properties
    #onPointerMoveHandler = null;
    #highlight = null;
    #selectedShape = null;
    #selectedShapeStartPosition = null;
    #selectedShapeStartVertices = null;
    #pointerStartPosition = null;
    //#endregion

    //#region Shape snap properties        
    #snapColor = null;
    #snapVertexMaterial = null;
    #snapThreshold = 0.2;

    #isSnapToVertexEnabled = false;

    set isSnapToVertexEnabled(value) {
        this.#isSnapToVertexEnabled = value;
        if (value)
            this.isSnapToLineEnabled = false;
        else
            this.#removeSnapVertex();
    }

    get isSnapToVertexEnabled() {
        return this.#isSnapToVertexEnabled;
    }        

    #isSnapToLineEnabled = false;

    set isSnapToLineEnabled(value) {
        this.#isSnapToLineEnabled = value;
        if (value)
            this.#isSnapToVertexEnabled = false;
        else {
            this.#removeSnapLine("x");
            this.#removeSnapLine("z");
        }
    }

    get isSnapToLineEnabled() {
        return this.#isSnapToLineEnabled;
    }

    //#endregion

    constructor(canvas, scene) {

        //#region Configure scene
        this.#canvas = canvas;
        this.#scene = scene;
        this.#camera = new BABYLON.ArcRotateCamera("camera", 0, 0, 15, new BABYLON.Vector3(0, 0, 0));
        this.#camera.attachControl(this.#canvas, true);
        this.#camera.inputs.attached.mousewheel.wheelPrecision = 50;
        const light = new BABYLON.HemisphericLight("light", new BABYLON.Vector3(1, 1, 0), this.#scene);
        //#endregion

        //#region Configure ground
        this.#ground = BABYLON.MeshBuilder.CreateGround("ground", {
            height: 1000,
            width: 1000,
            subdivisions: 1
        }, this.#scene);
        this.#ground.position.y = -minLayerOffset;
        this.#groundMaterial = new BABYLON.StandardMaterial("groundMaterial", this.#scene);
        this.#groundMaterial.alpha = 0;
        this.#ground.material = this.#groundMaterial;
        //#endregion

        //#region Configure Grid
        this.#gridMaterial = new BABYLON.GridMaterial("gridMaterial", this.#scene);
        this.#gridMaterial.gridRatio = 0.1; // 1: 1 grid per unit | 0.1: 10 grid per unit
        this.#gridMaterial.majorUnitFrequency = 5; // Grid major line frequency
        this.#gridMaterial.opacity = 0.8; // Grid opacity
        this.#gridMaterial.minorUnitVisibility = 0.85; // Grid minor lines visibility
        this.#gridMaterial.useMaxLine = true; // Remove brighter line intersections effect        
        this.#gridMaterial.lineColor = new BABYLON.Color3.White(); // Grid lines color
        //#endregion

        //#region Configure body
        this.#bodyMaterial = this.#bodyMaterial = new BABYLON.StandardMaterial("bodyMaterial", this.#scene);
        this.#bodyMaterial.diffuseTexture = new BABYLON.Texture("https://th.bing.com/th/id/R.539d1e9de72d9534b9f5ad4acbcae475?rik=GCisisx61UBRIA&riu=http%3a%2f%2fwww.myfreetextures.com%2fwp-content%2fuploads%2f2014%2f10%2fseamless-wood-background-1.jpg&ehk=UJomESiA%2bKBpeWdjz684u5n4ZGJDDKzE4TLUeiu0IPk%3d&risl=&pid=ImgRaw&r=0");
        this.#bodyMaterial.alpha = 1;
        //#endregion

        //#region Configure shapes
        this.#shapesMaterial = new BABYLON.StandardMaterial("shapesMaterial", this.#scene);
        this.#shapesMaterial.diffuseColor = new BABYLON.Color3.Green();
        this.#shapesMaterial.alpha = 0;
        //#endregion

        //#region Configure shape action manager and shape drag

        // Note:
        // BABYLON.PointerDragBehavior + Mesh.addBehavior / Mesh.removeBehavior 
        // was not used because it only support single axis movement.
        
        this.#shapeActionManager = new BABYLON.ActionManager(this.#scene);

        this.#shapeActionManager.registerAction(
            new BABYLON.ExecuteCodeAction(
                BABYLON.ActionManager.OnPickDownTrigger,
                this.#onShapePickDownTrigger.bind(this)
            )
        );

        this.#shapeActionManager.registerAction(
            new BABYLON.ExecuteCodeAction(
                BABYLON.ActionManager.OnPickUpTrigger,
                this.#onShapePickUpTrigger.bind(this)
            )
        );

        this.#onPointerMoveHandler = this.#onPointerMove.bind(this);

        this.#highlight = new BABYLON.HighlightLayer("hl1", scene);

        this.#snapColor = new BABYLON.Color3.White();
        this.#snapVertexMaterial = new BABYLON.StandardMaterial("snapGuideMaterial", this.#scene);
        this.#snapVertexMaterial.diffuseColor = this.#snapColor;
        this.#snapVertexMaterial.alpha = 0.75;
        //#endregion

    }

    //#region Grid functions

    showGrid(divisionsPerUnit, majorUnitFrequency) {
        this.#ground.material = this.#gridMaterial;
        this.setGridDivisions(divisionsPerUnit, majorUnitFrequency);
    }

    setGridDivisions(divisionsPerUnit, majorUnitFrequency) {
        if (divisionsPerUnit)
            this.#gridMaterial.gridRatio = 1/divisionsPerUnit;
        if (majorUnitFrequency)
            this.#gridMaterial.majorUnitFrequency = majorUnitFrequency;    
    }

    hideGrid() {
        this.#groundMaterial.material = this.#groundMaterial;
    }

    //#endregion
    
    //#region Drag shape functions

    #onShapePickDownTrigger (event) {
        // Set selected shape
        this.#selectedShape = event.meshUnderPointer;

        // Set start positions
        this.#pointerStartPosition = this.#getGroundPickedPosition();
        this.#selectedShapeStartPosition = this.#selectedShape.position.clone();
        this.#selectedShapeStartVertices = this.#getVertices(this.#selectedShape);

        // Disconnect camera from canvas
        setTimeout(() => {
            this.#camera.detachControl(this.#canvas);
        }, 0);

        // Add pointer move event listener
        this.#canvas.addEventListener("pointermove", this.#onPointerMoveHandler);

        // Set highlight
        //this._highlight.addMesh(this._selectedShape, BABYLON.Color3.White());
        this.#selectedShape.enableEdgesRendering();
        this.#selectedShape.edgesWidth = 2.0;
        this.#selectedShape.edgesColor = new BABYLON.Color4(1, 1, 1, 1);
    }

    #onShapePickUpTrigger (event) {
        // Validate event is preceded by pick down event
        if (!this.#selectedShape)
            return;
        // Clear start positions
        this.#pointerStartPosition = null;
        this.#selectedShapeStartPosition = null;
        // Reconnect camera to canvas
        this.#camera.attachControl(this.#canvas, true);
        // Remove pointer move event listener
        this.#canvas.removeEventListener("pointermove", this.#onPointerMoveHandler);        
        // Clear highlight
        this.#highlight.removeMesh(this.#selectedShape);
        this.#selectedShape.disableEdgesRendering();
        this.drawBody(this.#bodyWidth, this.#bodyHeight, this.#bodyDepth);
        // Clear selected shape
        this.#selectedShape = null;
        // Remove alignment lines
        this.#removeSnapVertex();
        this.#removeSnapLine("x");
        this.#removeSnapLine("z");
    }

    #onPointerMove(event) {
        const pointerCurrentPosition = this.#getGroundPickedPosition();
        const pointerDisplacement = pointerCurrentPosition.subtract(this.#pointerStartPosition);
        const newPosition = this.#selectedShapeStartPosition.add(pointerDisplacement);
        if (this.#isSnapToVertexEnabled)
            this.#snapToVertex(newPosition, pointerDisplacement);
        if (this.#isSnapToLineEnabled) {
            this.#snapToLine(newPosition, pointerDisplacement, "x");
            this.#snapToLine(newPosition, pointerDisplacement, "z");
        }
        this.#selectedShape.position = newPosition;
    }

    #getGroundPickedPosition() {
        let pickInfo = this.#scene.pick(
            this.#scene.pointerX, this.#scene.pointerY, 
            (mesh) => { return mesh == this.#ground; }
        );
        if (pickInfo.hit) {
            pickInfo.pickedPoint.y = 0;
            return pickInfo.pickedPoint;
        }
        return null;
    }

    //#endregion

    //#region Snap functions

    #snapToVertex(newPosition, pointerDisplacement) {
        // Get selected shape bouunding box vertices
        const selectedShapeVectices = this.#selectedShapeStartVertices.map(vector => vector.add(pointerDisplacement));

        let minVertixDistance = Number.MAX_VALUE;
        let minVertixVector = null;
        let minShapeVertix = null;

        this.#shapes.forEach((shape) => {
            // skip if shape is selected
            if (shape === this.#selectedShape)
                return;

            // Get min distance between selected shape vertices and shape vertices
            const shapeVertices = this.#getVertices(shape);
            shapeVertices.forEach((shapeVertix) => {
                selectedShapeVectices.forEach((selectedShapeVertix) => {
                    const vertixVector = shapeVertix.subtract(selectedShapeVertix);
                    const vertixDistance = vertixVector.length();
                    if (vertixDistance < minVertixDistance)
                    {
                        minVertixDistance = vertixDistance;
                        minVertixVector = vertixVector;
                        minShapeVertix = shapeVertix;
                    }
                });
            });
        });

        // Snap closest vertices if distance is less than snap threshold
        const isVertixDistanceLessThanThreshold = minVertixDistance < this.#snapThreshold;
        if (isVertixDistanceLessThanThreshold)
            newPosition.addInPlace(minVertixVector);

        // Draw or clear snap vertex
        if (isVertixDistanceLessThanThreshold)
            this.#drawSnapVertex(minShapeVertix.x, minShapeVertix.z);
        else
            this.#removeSnapVertex();

        return isVertixDistanceLessThanThreshold;
    }

    #drawSnapVertex(vertexX, vertexZ) {
        const snapVertex = this.#scene.getMeshByName('snapVertex');

        // Create snap vertex if it doesn't exist
        if (!snapVertex) {
            _createSnapVertex.call(this, vertexX, vertexZ);
            return;
        }

        // Update snap vertex if position changed
        if (snapVertex._x != vertexX || snapVertex._z != vertexZ) {
            this.#removeSnapVertex();
            _createSnapVertex.call(this, vertexX, vertexZ);
            return;
        }

        return;

        function _createSnapVertex(x, z) {
            // Create the snap vertex
            const snapVertex = BABYLON.MeshBuilder.CreateSphere("snapVertex", {
                diameter: 0.05
            }, this.#scene);
            snapVertex.position = new BABYLON.Vector3(x, 0, z);
            snapVertex.ispickable = false;
            snapVertex.material = this.#snapVertexMaterial;
        }
    }

    #removeSnapVertex() {
        const snapVertex = this.#scene.getMeshByName('snapVertex');
        if (snapVertex) {
            this.#scene.removeMesh(snapVertex);
            snapVertex.dispose();
        }
    }

    #snapToLine(newPosition, pointerDisplacement, axis) {
        // Get selected shape bouunding box vertices
        const selectedShapeVectices = this.#selectedShapeStartVertices.map(vector => vector.add(pointerDisplacement));

        // Get selected shape max and min x values
        const selectedShapeAxisValueSet = new Set(selectedShapeVectices.map(vector => vector[axis]));

        let minDelta = Number.MAX_VALUE;
        let minDeltaShapeAxisValue = null;

        this.#shapes.forEach((shape) => {
            // skip if shape is selected
            if (shape === this.#selectedShape)
                return;

            // Get max and min axis values
            const shapeVertices = this.#getVertices(shape);
            const shapeAxisValueSet = new Set(shapeVertices.map(vector => vector[axis]));

            // Get min distance between selected shape vertices and shape vertices
            selectedShapeAxisValueSet.forEach((selectedShapeAxisValue) => {
                shapeAxisValueSet.forEach((shapeAxisValue) => {
                    const axisDelta = shapeAxisValue - selectedShapeAxisValue;
                    if (Math.abs(axisDelta) < Math.abs(minDelta)) {
                        minDelta = axisDelta;
                        minDeltaShapeAxisValue = shapeAxisValue;
                    }
                });
            });
        });

        // Snap closest axis if distance is less than snap threshold
        const isAxisDeltaLessThanThreshold = Math.abs(minDelta) < this.#snapThreshold
        if (isAxisDeltaLessThanThreshold)
            newPosition[axis] += minDelta;

        // Draw or clear alignment line
        if (isAxisDeltaLessThanThreshold)
            this.#drawSnapLine(axis, minDeltaShapeAxisValue);
        else
            this.#removeSnapLine(axis);

        return isAxisDeltaLessThanThreshold;
    }

    #drawSnapLine(axis, axisValue) {
        const snapLine = this.#scene.getMeshByName(`${axis}SnapLine`);

        // Create snap line if it doesn't exist
        if (!snapLine) {
            _createSnapLine.call(this, axis, axisValue);
            return;
        }

        // Update snap line if axis value changed
        if (snapLine._axisValue != axisValue) {
            this.#removeSnapLine(axis);
            _createSnapLine.call(this, axis, axisValue);
            return;
        }

        return;

        function _createSnapLine(axis, axisValue) {
            // Get the endpoints for the alignment line
            const lineEndPoints = [ 
                new BABYLON.Vector3(-100, 0, -100), 
                new BABYLON.Vector3(100, 0, 100) ];
            lineEndPoints[0][axis] = axisValue;
            lineEndPoints[1][axis] = axisValue;

            // Create the alignment line
            const snapLine = BABYLON.MeshBuilder.CreateDashedLines(`${axis}SnapLine`, {
                points: lineEndPoints,
                dashSize: 1,
                gapSize: 1
            }, this.#scene);
            snapLine.ispickable = false;
            snapLine.color = this.#snapColor;
            snapLine.alpha = 0.5;
            snapLine._axisValue = axisValue;
        }
    }

    #removeSnapLine(axis) {
        const snapLine = this.#scene.getMeshByName(`${axis}SnapLine`);
        if (snapLine) {
            this.#scene.removeMesh(snapLine);
            snapLine.dispose();
        }
    }

    #getVertices(shape) {
        let snapVertices = [];
        let middlePoint = null;
        const shapeNamePrefix = shape.name.split("-")[0];
        const shapeWorldMatrix = shape.computeWorldMatrix(true);

        // Get shape vertices
        switch (shapeNamePrefix) {
            case "box":
                middlePoint = shape.position.clone();
                middlePoint.y = 0;
                snapVertices = [
                    new BABYLON.Vector3(0, shape._height/2, 0),
                    new BABYLON.Vector3(shape._width/2, shape._height/2, shape._depth/2),
                    new BABYLON.Vector3(-shape._width/2, shape._height/2, shape._depth/2),
                    new BABYLON.Vector3(shape._width/2, shape._height/2, -shape._depth/2),
                    new BABYLON.Vector3(-shape._width/2, shape._height/2, -shape._depth/2)
                ];
            break;
            case "cylinder":
                if (shape._isHorizontal) {
                    snapVertices = [
                        new BABYLON.Vector3(0, 0, 0),
                        new BABYLON.Vector3(shape._diameterTop/2, shape._height/2, 0),
                        new BABYLON.Vector3(-shape._diameterTop/2, shape._height/2, 0),
                        new BABYLON.Vector3(shape._diameterBottom/2, -shape._height/2, 0),
                        new BABYLON.Vector3(-shape._diameterBottom/2, -shape._height/2, 0)
                    ];
                }
                else {
                    const shapeVerticesData = shape.getVerticesData(BABYLON.VertexBuffer.PositionKind);
                    for (let i = 0; i < shapeVerticesData.length; i += 3) {
                        let vertex = new BABYLON.Vector3(shapeVerticesData[i], shapeVerticesData[i + 1], shapeVerticesData[i + 2]);
                        snapVertices.push(vertex);s
                    }
                }
                break;
            case "sphere":
                middlePoint = shape.position.clone();
                middlePoint.y = 0;
                snapVertices = [
                    new BABYLON.Vector3(0, 0, 0),
                    new BABYLON.Vector3(shape._diameterX/2, 0, 0),
                    new BABYLON.Vector3(-shape._diameterX/2, 0, 0),
                    new BABYLON.Vector3(0, 0, shape._diameterZ/2),
                    new BABYLON.Vector3(0, 0, -shape._diameterZ/2)
                ];
                break;
            default:
                snapVertices = null;
        }

        // Remove overlapping vertices
        snapVertices = this.#mergeOverlappingVertices(snapVertices, minLayerOffset);

        // Transform vertices to world coordinates
        snapVertices = snapVertices.map((v) => {
            let vertex = BABYLON.Vector3.TransformCoordinates(v, shapeWorldMatrix);
            vertex.y = 0;
            return vertex;
        });

        return snapVertices;
    }

    #mergeOverlappingVertices(vertices, mergeRadius) {
        const mergedVertices = [];

        for (let i = 0; i < vertices.length; i++) {
            let overlaps = false;
            for (let j = 0; j < mergedVertices.length; j++) {
                const distance = BABYLON.Vector3.Distance(vertices[i], mergedVertices[j]);
                if (distance < mergeRadius) {
                    overlaps = true;
                    break;
                }
            }
            if (!overlaps)
                mergedVertices.push(vertices[i]);
        }

        return mergedVertices;
    }

    //#endregion

    //#region Body functions

    drawBody(bodyWidth, bodyHeight, bodyDepth) {

        this.#bodyWidth = bodyWidth;
        this.#bodyHeight = bodyHeight;
        this.#bodyDepth = bodyDepth;

        //#region Dispose previous body
        if (this.#body) {
            this.#scene.removeMesh(this.#body);
            this.#body.dispose();
        }
        //#endregion

        //#region Create body CSG (Constructive Solis Geometry)
        const newBodyDraftMesh = BABYLON.MeshBuilder.CreateBox("draftBody", {
            width: bodyWidth,
            height: bodyHeight - (2 * minLayerOffset),
            depth: bodyDepth
        });
        newBodyDraftMesh.position = new BABYLON.Vector3(0, -bodyHeight/2, 0)
        const bodyCSG = BABYLON.CSG.FromMesh(newBodyDraftMesh);
        this.#scene.removeMesh(newBodyDraftMesh);
        newBodyDraftMesh.dispose();
        //#endregion

        //#region Subtract shapes from body
        this.#shapes.forEach((shape) => {
            const shapeCSG = BABYLON.CSG.FromMesh(shape);
            bodyCSG.subtractInPlace(shapeCSG);
        });
        //#endregion

        //#region Render
        this.#body = bodyCSG.toMesh("body", this.#bodyMaterial, this.#scene);
        this.#body.material = this.#bodyMaterial;
        this.#body.ispickable = false;
        //#endregion
    }

    addBoxShape(width, height, depth) {
        const box = BABYLON.MeshBuilder.CreateBox(this.#generateShapeName("box"), 
        {
            width: width,
            height: height,
            depth: depth
        }, this.#scene);
        box.material = this.#shapesMaterial;
        box.position = new BABYLON.Vector3(0, -height/2, 0);
        box.actionManager = this.#shapeActionManager;
        box._width = width;
        box._height = height;
        box._depth = depth;
        this.#shapes.push(box);
    }

    addCylinerShape(height, diameterTop, diameterBottom, tessellation, isHorizontal) {
        const cylinder = BABYLON.MeshBuilder.CreateCylinder(this.#generateShapeName("cylinder"), {
            height: height,
            diameterTop: diameterTop,
            diameterBottom: diameterBottom,
            tessellation: 2 * tessellation,
            updatable: true
        }, this.#scene);
        cylinder.material = this.#shapesMaterial;

        if (isHorizontal) {
            cylinder.position = new BABYLON.Vector3(0, 0, 0);
            cylinder.rotation.x = Math.PI/2;

            // Remove the top half of the rotated cylinder
            const vertices = cylinder.getVerticesData(BABYLON.VertexBuffer.PositionKind);
            for (let i = 0; i < vertices.length; i += 3) {
                if (vertices[i + 2] < minLayerOffset)
                    vertices[i + 2] = 0;
            }
            cylinder.updateVerticesData(BABYLON.VertexBuffer.PositionKind, vertices);
        }
        else
            cylinder.position = new BABYLON.Vector3(0, -height/2, 0);

        cylinder.actionManager = this.#shapeActionManager;
        cylinder._yOffset = isHorizontal ? 0 : height/2;
        cylinder._height = height;
        cylinder._diameterTop = diameterTop;
        cylinder._diameterBottom = diameterBottom;
        cylinder._isHorizontal = isHorizontal;
        this.#shapes.push(cylinder);
    }

    addSphereShape(diameterX, diameterY, diameterZ, tessellation) {
        const sphere = BABYLON.MeshBuilder.CreateSphere(this.#generateShapeName("sphere"), {
            diameterX: diameterX,
            diameterY: diameterY,
            diameterZ: diameterZ,
            segments: tessellation,
            updatable: true
        }, this.#scene);

        // Remove the top half of the sphere
        const vertices = sphere.getVerticesData(BABYLON.VertexBuffer.PositionKind);
        for (let i = 0; i < vertices.length; i += 3) {
            const vertex = new BABYLON.Vector3(vertices[i], vertices[i + 1], vertices[i + 2]);
            if (vertex.y > 0)
                vertices[i + 1] = 0;
        }
        sphere.updateVerticesData(BABYLON.VertexBuffer.PositionKind, vertices);

        sphere.position = new BABYLON.Vector3(0, 0, 0);
        sphere.material = this.#shapesMaterial;
        sphere.actionManager = this.#shapeActionManager;
        sphere._diameterX = diameterX;
        sphere._diameterY = diameterY;
        sphere._diameterZ = diameterZ;
        this.#shapes.push(sphere);
    }

    addTextShape(text, size, depth) {
        //const fontData = await (await fetch("./Roboto_Regular.json")).json();
        const fontData = Roboto_Regular;
        const textMesh = BABYLON.MeshBuilder.CreateText(this.#generateShapeName("text"), text, fontData,
        {
            size: size,
            resolution: 16,
            depth: depth,
            //sideOrientation: BABYLON.Mesh.DEFAULTSIDE
        }, this.#scene);
        textMesh.material = this.#shapesMaterial;
        textMesh.rotation.x = Math.PI/2;
        textMesh.position = new BABYLON.Vector3(0, 0, 0);
        textMesh.actionManager = this.#shapeActionManager;
        textMesh.text = text;
        this.#shapes.push(textMesh);
    }

    #generateShapeName(prefix) {
        const timePart = (new Date()).getTime();
        const randomSuffix = Math.random().toString(36).slice(2);
        return `${prefix}-${timePart}-${randomSuffix}`
    }

    //#endregion
}

let xactFitBuilder = null;

// Add your code here matching the playground format
const createScene = async function () {
    const scene = new BABYLON.Scene(engine);

    xactFitBuilder = new XactFitBuilder(canvas, scene);
    xactFitBuilder.addBoxShape(1, 0.6, 2);
    //xactFitBuilder.addBoxShape(1, 0.6, 2);
    //xactFitBuilder.addBoxShape(0.75, 0.5, 1);
    //xactFitBuilder.addCylinerShape(1, 1.5, 1, 4, false);
    //xactFitBuilder.addCylinerShape(1, 1.5, 1, 4, true);
    xactFitBuilder.addSphereShape(1.5, 1, 1, 16);
    //xactFitBuilder.addCapsuleShape(2, 1, 8);
    //xactFitBuilder.addTextShape("HSO", 0.25, 0.5);
    xactFitBuilder.drawBody(3, 2, 5);
    /*xactFitBuilder.shapes.forEach((shape) => {
        shape.showBoundingBox = true;
    });*/

    return scene;
};

const start = async function () {
    const scene = await createScene(); //Call the createScene function

    // Register a render loop to repeatedly render the scene
    engine.runRenderLoop(function () {
        scene.render();
    });
    
    // Watch for browser/canvas resize events
    window.addEventListener("resize", function () {
        engine.resize();
    });
}

start();

