import classNames from "classnames";
import React, { useEffect, useRef, useState } from "react";

import { selectors } from "ui/reducers";
import { AppDispatch } from "ui/setup";
import { useAppDispatch, useAppSelector } from "ui/setup/hooks";
import { getPositionFromTime, getTimeFromPosition } from "ui/utils/timeline";

import { EditMode } from "./Timeline";

function stopEvent(event: MouseEvent) {
  event.preventDefault();
  event.stopPropagation();
}

type Props = {
  editMode: EditMode | null;
  setEditMode: React.Dispatch<React.SetStateAction<EditMode | null>>;
  updateFocusRegionThrottled: (dispatch: AppDispatch, begin: number, end: number) => void;
};

export default function ConditionalFocuser({
  editMode,
  setEditMode,
  updateFocusRegionThrottled,
}: Props) {
  const focusRegion = useAppSelector(selectors.getFocusRegion);
  const showFocusModeControls = useAppSelector(selectors.getShowFocusModeControls);

  if (!focusRegion || !showFocusModeControls) {
    return null;
  }

  return (
    <Focuser
      editMode={editMode}
      setEditMode={setEditMode}
      updateFocusRegionThrottled={updateFocusRegionThrottled}
    />
  );
}

function Focuser({ editMode, setEditMode, updateFocusRegionThrottled }: Props) {
  const dispatch = useAppDispatch();
  const focusRegion = useAppSelector(selectors.getFocusRegion)!;
  const zoomRegion = useAppSelector(selectors.getZoomRegion);

  // Mirror focus state so we can re-render immediately and dispatch throttled Redux updates
  const [displayedFocusRegion, setDisplayedFocusRegion] = useState({
    beginTime: focusRegion?.begin.time ?? zoomRegion.beginTime,
    endTime: focusRegion?.end.time ?? zoomRegion.endTime,
  });

  const containerRef = useRef<HTMLDivElement>(null);
  const draggableAreaRef = useRef<HTMLDivElement>(null);
  const didDragRef = useRef<boolean>(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !focusRegion || !editMode) {
      return;
    }

    // Stop dragging on "click"
    const onDocumentClick = (event: MouseEvent) => {
      switch (editMode.type) {
        case "drag":
        case "resize-end":
        case "resize-start": {
          // If this was a real click, we should allow this event to pass through to update the current time.
          // If it is part of a drag operation, we shouldn't.
          if (didDragRef.current) {
            stopEvent(event);

            didDragRef.current = false;
          }

          setEditMode(null);
          break;
        }
      }
    };

    const onDocumentMouseMove = (event: MouseEvent) => {
      stopEvent(event);

      const { movementX, pageX } = event;
      if (movementX !== 0) {
        didDragRef.current = true;

        const relativeMouseX = pageX - (editMode.dragOffset || 0);

        const mouseTime = getTimeFromPosition(
          relativeMouseX,
          container.getBoundingClientRect(),
          zoomRegion
        );
        const beginTime = focusRegion.begin.time;
        const endTime = focusRegion.end.time;

        switch (editMode.type) {
          case "drag": {
            // Re-center the focus region around the mouse cursor.
            const focusRegionDuration = endTime - beginTime;
            let newEndTime = mouseTime + focusRegionDuration / 2;
            let newBeginTime = mouseTime - focusRegionDuration / 2;

            // Make sure the new focus region is still within our zoom bounds.
            if (newBeginTime < zoomRegion.beginTime) {
              newEndTime += zoomRegion.beginTime - newBeginTime;
              newBeginTime = zoomRegion.beginTime;
            } else if (newEndTime > zoomRegion.endTime) {
              newBeginTime -= newEndTime - zoomRegion.endTime;
              newEndTime = zoomRegion.endTime;
            }

            updateDisplayedFocusRegion(newBeginTime, newEndTime);
            break;
          }
          case "resize-end": {
            updateDisplayedFocusRegion(beginTime, mouseTime);
            break;
          }
          case "resize-start": {
            updateDisplayedFocusRegion(mouseTime, endTime);
            break;
          }
        }
      }
    };

    // Stop all drag operations when the mouse leaves the window.
    const onDocumentMouseLeave = (event: MouseEvent) => {
      if (
        event.clientY >= 0 &&
        event.clientX >= 0 &&
        event.clientX <= window.innerWidth &&
        event.clientY <= window.innerHeight
      ) {
        // The mouse is still within the window.
        return;
      }

      switch (editMode.type) {
        case "drag":
        case "resize-end":
        case "resize-start": {
          setEditMode(null);
          break;
        }
      }
    };

    // Block "mouseup" events for drag-in-progress
    const onDocumentMouseUp = (event: MouseEvent) => {
      switch (editMode.type) {
        case "drag":
        case "resize-end":
        case "resize-start": {
          // If this was a real mouseup, we should allow this event to pass through to update the current time.
          // If it is part of a drag operation, we shouldn't.
          if (didDragRef.current) {
            stopEvent(event);
          }

          // Don't reset the ref or edit mode during mouse-up.
          // Wait until the subsequent "click" event so that we claim both.
          break;
        }
      }
    };

    const updateDisplayedFocusRegion = (beginTime: number, endTime: number) => {
      setDisplayedFocusRegion({ beginTime, endTime });
      updateFocusRegionThrottled(dispatch, beginTime, endTime);
    };

    document.addEventListener("click", onDocumentClick, true);
    document.addEventListener("mousemove", onDocumentMouseMove, true);
    document.addEventListener("mouseleave", onDocumentMouseLeave, true);
    document.addEventListener("mouseup", onDocumentMouseUp, true);

    return () => {
      document.removeEventListener("click", onDocumentClick, true);
      document.removeEventListener("mousemove", onDocumentMouseMove, true);
      document.removeEventListener("mouseleave", onDocumentMouseLeave, true);
      document.removeEventListener("mouseup", onDocumentMouseUp, true);
    };
  });

  if (!focusRegion) {
    return null;
  }

  const setEditModeToMove = (event: React.MouseEvent) => {
    const draggableArea = draggableAreaRef.current!;
    const { left, width } = draggableArea.getBoundingClientRect();
    const relativeMouseX = event.pageX - left;
    const dragOffset = relativeMouseX - width / 2;
    setEditMode({ dragOffset, type: "drag" });
  };
  const setEditModeToResizeEnd = () => setEditMode({ type: "resize-end" });
  const setEditModeToResizeStart = () => setEditMode({ type: "resize-start" });

  const left = getPositionFromTime(displayedFocusRegion.beginTime, zoomRegion);
  const right = getPositionFromTime(displayedFocusRegion.endTime, zoomRegion);

  return (
    <div className="relative top-0 left-0 h-full w-full" ref={containerRef}>
      <div
        className="group absolute h-full"
        ref={draggableAreaRef}
        style={{
          left: `${left}%`,
          width: `${right - left}%`,
        }}
      >
        <div
          className={classNames("h-full w-full bg-themeFocuserBgcolor opacity-50", {
            "cursor-grab": editMode === null,
            "cursor-grabbing": editMode?.type === "drag",
          })}
          onMouseDown={setEditModeToMove}
        />

        <div
          className="absolute top-0 left-0 -ml-2 h-full w-2 transform cursor-ew-resize"
          onMouseDown={setEditModeToResizeStart}
        >
          <div
            className={classNames("absolute right-0 h-full w-1", {
              "bg-themeFocuserBgcolor": editMode?.type !== "resize-start",
              "bg-secondaryAccent": editMode?.type === "resize-start",
            })}
          />
        </div>

        <div
          className="absolute top-0 right-0 -mr-2 h-full w-2 transform cursor-ew-resize"
          onMouseDown={setEditModeToResizeEnd}
        >
          <div
            className={classNames("absolute left-0 h-full w-1", {
              "bg-themeFocuserBgcolor": editMode?.type !== "resize-end",
              "bg-secondaryAccent": editMode?.type === "resize-end",
            })}
          />
        </div>
      </div>
    </div>
  );
}
