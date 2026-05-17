import StatusBadge from './StatusBadge';

export type DetailBreadcrumbKind = 'plan' | 'unit' | 'task';

export interface DetailBreadcrumbItem {
  type: DetailBreadcrumbKind;
  id: string;
  label: string;
  ticket?: string | null;
  status?: string | null;
}

interface DetailBreadcrumbProps {
  items: DetailBreadcrumbItem[];
  onSelectItem?: (item: { type: DetailBreadcrumbKind; id: string }) => void;
}

const KIND_LABEL: Record<DetailBreadcrumbKind, string> = {
  plan: 'Plan',
  unit: 'Unit',
  task: 'Task',
};

export default function DetailBreadcrumb({ items, onSelectItem }: DetailBreadcrumbProps) {
  if (items.length === 0) return null;
  return (
    <nav aria-label="detail-breadcrumb" className="text-xs" data-testid="detail-breadcrumb">
      <ol className="flex items-center gap-1 flex-wrap">
        {items.map((item, idx) => {
          const isCurrent = idx === items.length - 1;
          const kindLabel = KIND_LABEL[item.type];
          return (
            <li
              key={`${item.type}-${item.id}`}
              className="flex items-center gap-1"
              aria-current={isCurrent ? 'page' : undefined}
              data-testid={`detail-breadcrumb-${item.type}`}
            >
              {isCurrent ? (
                <span className="flex items-center gap-1 text-foreground font-medium truncate max-w-[18rem]">
                  <span className="text-muted">{kindLabel}:</span>
                  {item.ticket && (
                    <span className="font-mono text-primary">{item.ticket}</span>
                  )}
                  <span>{item.label}</span>
                  {item.status && <StatusBadge status={item.status} size="sm" />}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => onSelectItem?.({ type: item.type, id: item.id })}
                  disabled={!onSelectItem}
                  className="flex items-center gap-1 text-primary hover:underline truncate max-w-[14rem] disabled:cursor-default disabled:no-underline"
                  data-detail-id={item.id}
                  data-detail-type={item.type}
                  title={item.label}
                >
                  <span className="text-muted">{kindLabel}:</span>
                  {item.ticket && (
                    <span className="font-mono">{item.ticket}</span>
                  )}
                  <span className="text-foreground">{item.label}</span>
                </button>
              )}
              {!isCurrent && <span aria-hidden className="text-muted">›</span>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
