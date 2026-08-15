import { FormEvent, useState } from "react";
import { ArrowRight, LockKeyhole, UserRound } from "lucide-react";

type LoginPatient = {
  id: string;
  name: string;
};

type LoginScreenProps = {
  patients: LoginPatient[];
  onLogin: (patientId: string) => void;
};

function normalizeDemoName(value: string) {
  return value.replace(/[（(]虛構[）)]/g, "").trim();
}

export default function LoginScreen({ patients, onLogin }: LoginScreenProps) {
  const [accountName, setAccountName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedName = normalizeDemoName(accountName);
    const patient = patients.find((item) => normalizeDemoName(item.name) === normalizedName);

    if (!patient) {
      setError("找不到這個示範病患姓名，請確認帳號或從下方選擇。");
      return;
    }
    if (!password.trim()) {
      setError("Demo 密碼可以任意填寫，但不能留空。");
      return;
    }

    setError("");
    onLogin(patient.id);
  }

  return (
    <main className="login-shell">
      <div className="login-brand brand-wordmark" aria-label="CuriLoop">CuriLoop</div>

      <section className="login-panel" aria-labelledby="login-title">
        <h1 id="login-title">開始您的<br />照護旅程</h1>
        <p className="login-subtitle">重述醫病關係　專屬於每個人的健康照護助手</p>

        <div className="login-patient-section">
          <span>示範帳號</span>
          <div className="login-patient-list">
            {patients.map((patient) => (
              <button
                type="button"
                key={patient.id}
                className={normalizeDemoName(accountName) === normalizeDemoName(patient.name) ? "selected" : ""}
                onClick={() => {
                  setAccountName(normalizeDemoName(patient.name));
                  setError("");
                }}
              >
                {normalizeDemoName(patient.name)}
              </button>
            ))}
          </div>
        </div>

        <div className="login-divider"><span>使用姓名登入</span></div>

        <form className="login-form" onSubmit={submit} noValidate>
          <label htmlFor="demo-account">帳號姓名</label>
          <div className="login-field">
            <UserRound aria-hidden="true" />
            <input
              id="demo-account"
              value={accountName}
              onChange={(event) => {
                setAccountName(event.target.value);
                setError("");
              }}
              placeholder="例如：陳怡安"
              autoComplete="off"
              required
            />
          </div>

          <label htmlFor="demo-password">密碼</label>
          <div className="login-field">
            <LockKeyhole aria-hidden="true" />
            <input
              id="demo-password"
              type="password"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                setError("");
              }}
              placeholder="Demo 可任意填寫"
              autoComplete="off"
              required
            />
          </div>

          {error ? <p className="login-error" role="alert">{error}</p> : null}

          <button className="login-submit" type="submit" disabled={!patients.length}>
            <span>{patients.length ? "進入照護介面" : "載入示範帳號中…"}</span>
            <ArrowRight aria-hidden="true" />
          </button>
        </form>

        <p className="login-disclaimer">
          Demo 模式不執行真實身分驗證，也不應輸入真實病歷或正式帳號密碼。
        </p>
      </section>
    </main>
  );
}
