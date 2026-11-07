/** Animated skeleton placeholder for medicine cards during loading */
export function SkeletonCard() {
  return (
    <div className="skel-card" aria-hidden="true">
      <div className="skel-top">
        <div className="skel-icon skel-pulse" />
        <div className="skel-badge skel-pulse" />
      </div>
      <div className="skel-body">
        <div className="skel-line skel-pulse" style={{ width: '70%', height: 16 }} />
        <div className="skel-line skel-pulse" style={{ width: '50%', height: 13, marginTop: 8 }} />
        <div className="skel-line skel-pulse" style={{ width: '40%', height: 12, marginTop: 6 }} />
      </div>
      <div className="skel-footer">
        <div className="skel-price skel-pulse" />
        <div className="skel-btn skel-pulse" />
      </div>
    </div>
  );
}
