"use strict";
const definition = require("./pages/home/home");
const {CanvasUI} = require("./lib/canvas-ui");
const {createGameRuntime} = require("./lib/game-runtime");
createGameRuntime({wx, definition, Renderer:CanvasUI});
