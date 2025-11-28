 const btn = document.getElementById("btnSobre");
  const box = document.getElementById("sobreBox");

  btn.addEventListener("click", () => {
    if (box.style.display === "block") {
      box.style.display = "none";
    } else {
      box.style.display = "block";
    }
  });