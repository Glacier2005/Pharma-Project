const CFG = {
  PENDING:          { label: 'Pending',          cls: 'amber'  },
  ACCEPTED:         { label: 'Accepted',         cls: 'cyan'   },
  OUT_FOR_DELIVERY: { label: 'Out for Delivery', cls: 'purple' },
  DELIVERED:        { label: 'Delivered',        cls: 'green'  },
  CANCELLED:        { label: 'Cancelled',        cls: 'red'    },
};

export function StatusBadge({ status }) {
  const { label, cls } = CFG[status] ?? { label: status, cls: 'muted' };
  return <span className={`status-badge s-${cls}`}>{label}</span>;
}
