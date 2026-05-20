interface AdminSectionPlaceholderProps {
  title: string;
  body: string;
  actionLabel?: string;
  disabledActionReason?: string;
}

export function AdminSectionPlaceholder(props: AdminSectionPlaceholderProps) {
  return (
    <section className="settings-section admin-placeholder-section">
      <div className="admin-panel-header">
        <h3 className="heading-section settings-section-title">{props.title}</h3>
        {props.actionLabel ? (
          <button type="button" className="btn btn-secondary btn-sm" disabled>
            {props.actionLabel}
          </button>
        ) : null}
      </div>
      <div className="admin-empty">
        <p>{props.body}</p>
        {props.disabledActionReason ? <p>{props.disabledActionReason}</p> : null}
      </div>
    </section>
  );
}
