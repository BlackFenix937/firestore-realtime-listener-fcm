function getEmail() {
  return new URLSearchParams(window.location.search).get("email");
}

// 👁️ Mostrar / ocultar contraseña
function togglePass(id) {
  const input = document.getElementById(id);
  input.type = input.type === "password" ? "text" : "password";
}

// 🔒 Validar fuerza
function checkStrength(password) {

  let strengthText = "";
  let strengthClass = "";

  if (password.length < 6) {
    strengthText = "Débil";
    strengthClass = "weak";
  } else if (password.match(/[A-Z]/) && password.match(/[0-9]/)) {
    strengthText = "Fuerte";
    strengthClass = "strong";
  } else {
    strengthText = "Media";
    strengthClass = "medium";
  }

  const el = document.getElementById("strength");
  el.innerText = "Seguridad: " + strengthText;
  el.className = "strength " + strengthClass;
}

// Detectar escritura
document.getElementById("password").addEventListener("input", (e) => {
  checkStrength(e.target.value);
});

// 🔑 Reset
async function resetPassword() {

  const password = document.getElementById("password").value;
  const confirm = document.getElementById("confirm").value;
  const msg = document.getElementById("msg");

  const email = getEmail();

  msg.innerText = "";

  if (!email) {
    msg.innerText = "❌ Error: email no encontrado";
    return;
  }

  if (!password || !confirm) {
    msg.innerText = "⚠️ Completa todos los campos";
    return;
  }

  if (password !== confirm) {
    msg.innerText = "❌ No coinciden";
    return;
  }

  if (password.length < 6) {
    msg.innerText = "⚠️ Mínimo 6 caracteres";
    return;
  }

  try {

    msg.innerText = "⏳ Actualizando...";

    const res = await fetch("/reset-password", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        email: email,
        password: password
      })
    });

    if (res.ok) {
      msg.innerText = "✅ Contraseña actualizada";
    } else {
      msg.innerText = "❌ Error al actualizar";
    }

  } catch (e) {
    msg.innerText = "❌ Error de conexión";
  }
}