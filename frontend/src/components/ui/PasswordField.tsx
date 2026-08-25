import { useState, type InputHTMLAttributes } from "react";

export function PasswordField(props: InputHTMLAttributes<HTMLInputElement>) {
  const [visible, setVisible] = useState(false);
  const id = props.id;
  return (
    <span className="password-input">
      <input {...props} type={visible ? "text" : "password"} />
      <button
        type="button"
        aria-controls={id}
        aria-label={visible ? "Hide password" : "Show password"}
        title={visible ? "Hide password" : "Show password"}
        onClick={() => setVisible((value) => !value)}
      >
        <span aria-hidden="true">{visible ? "◉" : "◎"}</span>
      </button>
    </span>
  );
}
