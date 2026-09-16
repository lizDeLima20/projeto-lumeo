import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DesktopReaderStateMachine } from "../src/reader/desktop/DesktopReaderStateMachine";

describe("DesktopReaderStateMachine", () => {
  it("mantém capa fechada quando o registro existe mas o progresso é 0%", () => {
    const state = new DesktopReaderStateMachine();
    state.restore(0);
    assert.equal(state.state, "CLOSED");
    assert.equal(state.isClosed, true);
  });

  it("retoma aberto apenas com progresso real", () => {
    const state = new DesktopReaderStateMachine();
    state.restore(0.01);
    assert.equal(state.state, "OPEN");
    assert.equal(state.isClosed, false);
  });

  it("a virada da capa fechada ainda pode abrir o livro", () => {
    const state = new DesktopReaderStateMachine();
    state.restore(0);
    state.beginDrag(1);
    state.beginSettling(1);
    assert.equal(state.state, "CLOSED");
    assert.equal(state.beginOpening(), true);
    state.opened();
    state.settle();
    assert.equal(state.state, "OPEN");
  });

  it("libera o estado depois de cancelamento, blur ou perda de captura", () => {
    const state = new DesktopReaderStateMachine();
    state.restore(42);
    assert.equal(state.beginDrag(1), true);
    assert.equal(state.state, "DRAGGING_NEXT");
    state.beginSettling(1);
    state.settle();
    assert.equal(state.state, "OPEN");
  });
});
