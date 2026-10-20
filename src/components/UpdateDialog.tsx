import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { closeUpdateDialog, installUpdate, openDownloadPage, useUpdateState } from "../lib/updates";

/** Show 0.2 instead of 0.2.0, same as About. */
function displayVersion(v: string): string {
  return v.replace(/\.0$/, "");
}

export function UpdateDialog() {
  const { open, phase, version, notes, installed, progress, error } = useUpdateState();
  const primaryRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeUpdateDialog();
      }
    };
    document.addEventListener("keydown", onKey, true);
    requestAnimationFrame(() => primaryRef.current?.focus());
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, phase]);

  if (!open) return null;

  let title = "Updates";
  let body: React.ReactNode = null;
  let actions: React.ReactNode = (
    <button ref={primaryRef} type="button" className="about-ok" onClick={closeUpdateDialog}>
      OK
    </button>
  );

  if (phase === "checking") {
    body = <p className="about-blurb">Checking for updates…</p>;
  } else if (phase === "none") {
    body = <p className="about-blurb">Grimview is up to date.</p>;
  } else if (phase === "error") {
    title = "Update failed";
    body = (
      <>
        <p className="about-blurb">Couldn't reach the update server or finish the update.</p>
        <p className="about-meta update-error">{error}</p>
      </>
    );
  } else if (phase === "downloading") {
    title = `Updating to ${displayVersion(version)}`;
    body = (
      <>
        <p className="about-blurb">Downloading. Grimview will close, install and reopen.</p>
        <div className="update-progress" aria-hidden="true">
          <div
            className={progress === null ? "update-progress-bar indeterminate" : "update-progress-bar"}
            style={progress === null ? undefined : { width: `${Math.round(progress * 100)}%` }}
          />
        </div>
      </>
    );
    actions = null;
  } else if (phase === "available") {
    title = `Grimview ${displayVersion(version)} is available`;
    body = (
      <>
        {notes ? <div className="update-notes">{notes}</div> : null}
        <p className="about-meta">
          {installed
            ? "Grimview will close, install and reopen. Other Grimview windows close too."
            : "This is the portable copy, so it can't update itself. Download the new version from GitHub."}
        </p>
      </>
    );
    actions = (
      <div className="update-actions">
        <button type="button" className="update-later" onClick={closeUpdateDialog}>
          Later
        </button>
        {installed ? (
          <button ref={primaryRef} type="button" className="about-ok" onClick={() => void installUpdate()}>
            Install
          </button>
        ) : (
          <button ref={primaryRef} type="button" className="about-ok" onClick={openDownloadPage}>
            Download
          </button>
        )}
      </div>
    );
  }

  return createPortal(
    <div className="about-overlay" role="presentation" onMouseDown={closeUpdateDialog}>
      <div
        className="about-dialog update-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h1 id="update-title" className="about-title">
          {title}
        </h1>
        {body}
        {actions}
      </div>
    </div>,
    document.body,
  );
}
