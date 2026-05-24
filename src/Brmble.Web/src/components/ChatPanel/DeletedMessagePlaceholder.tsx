interface DeletedMessagePlaceholderProps {
  text: string;
}

export function DeletedMessagePlaceholder({ text }: DeletedMessagePlaceholderProps) {
  return (
    <span className="deleted-message-placeholder" aria-label={text}>
      {text}
    </span>
  );
}
