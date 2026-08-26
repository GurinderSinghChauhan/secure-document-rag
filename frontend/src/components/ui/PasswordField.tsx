import { useState, type InputHTMLAttributes } from "react";
import { Button } from "./Button";
import { Input } from "./FormControls";

export function PasswordField(props: InputHTMLAttributes<HTMLInputElement>) {
  const [visible, setVisible] = useState(false);
  const id = props.id;
  return (
    <span className="password-input">
      <Input {...props} type={visible ? "text" : "password"} />
      <Button
        type="button"
        aria-controls={id}
        aria-label={visible ? "Hide password" : "Show password"}
        title={visible ? "Hide password" : "Show password"}
        onClick={() => setVisible((value) => !value)}
      >
        <span aria-hidden="true">{visible ? "◉" : "◎"}</span>
      </Button>
    </span>
  );
}
