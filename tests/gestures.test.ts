import { describe, it, expect, vi } from "vitest";
import { GestureRecognizer, type Pt } from "../src/gestures";

function at(x: number, y: number): Pt[] {
  return [{ x, y }];
}

function make() {
  const cb = {
    onPullTitle: vi.fn(),
    onTargetScrub: vi.fn(),
    onToggle: vi.fn(),
    onHold: vi.fn(),
  };
  return { cb, r: new GestureRecognizer(cb) };
}

describe("GestureRecognizer", () => {
  it("swipe right decreases (inverse), swipe left increases", () => {
    const { cb, r } = make();
    r.start(at(100, 100), 0);
    r.move(at(150, 100), 50); // +50px right → -2
    expect(cb.onTargetScrub).toHaveBeenCalledWith(-2);
    cb.onTargetScrub.mockClear();
    r.move(at(100, 100), 80); // back left 50px → +2
    expect(cb.onTargetScrub).toHaveBeenCalledWith(2);
    r.end(100);
    expect(cb.onPullTitle).not.toHaveBeenCalled();
  });

  it("swipe down fires the title pull once", () => {
    const { cb, r } = make();
    r.start(at(100, 100), 0);
    r.move(at(100, 200), 50);
    r.move(at(100, 260), 80);
    expect(cb.onPullTitle).toHaveBeenCalledTimes(1);
    expect(cb.onTargetScrub).not.toHaveBeenCalled();
  });

  it("horizontal scrub never triggers the title pull", () => {
    const { cb, r } = make();
    r.start(at(100, 100), 0);
    r.move(at(160, 130), 50);
    r.move(at(220, 160), 80);
    expect(cb.onPullTitle).not.toHaveBeenCalled();
    expect(cb.onTargetScrub).toHaveBeenCalled();
  });

  it("a still hold past holdMs toggles, with progress feedback", () => {
    const { cb, r } = make();
    r.start(at(100, 100), 0);
    r.poll(225); // halfway
    expect(cb.onHold).toHaveBeenLastCalledWith(expect.closeTo(0.5, 2));
    r.poll(460); // past 450ms
    expect(cb.onToggle).toHaveBeenCalledTimes(1);
    // Holding longer does not toggle again.
    r.poll(900);
    expect(cb.onToggle).toHaveBeenCalledTimes(1);
  });

  it("movement cancels the hold", () => {
    const { cb, r } = make();
    r.start(at(100, 100), 0);
    r.poll(100);
    r.move(at(130, 100), 150); // moved > cancel threshold
    r.poll(500);
    expect(cb.onToggle).not.toHaveBeenCalled();
    expect(cb.onHold).toHaveBeenLastCalledWith(null);
  });

  it("lifting before holdMs does not toggle", () => {
    const { cb, r } = make();
    r.start(at(100, 100), 0);
    r.poll(200);
    r.end(300);
    r.poll(800);
    expect(cb.onToggle).not.toHaveBeenCalled();
    expect(cb.onHold).toHaveBeenLastCalledWith(null);
  });

  it("a second finger cancels the gesture", () => {
    const { cb, r } = make();
    r.start(at(100, 100), 0);
    r.start([{ x: 100, y: 100 }, { x: 200, y: 100 }], 50); // pinch
    r.poll(600);
    expect(cb.onToggle).not.toHaveBeenCalled();
  });
});
