#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SkillDrop — processa centenas de arquivos SKILL.md um por um,
arrastando cada um para o Claude Code (ou outro app externo).

Uso:
    python skilldrop.py

Estado é salvo em skilldrop_state.json na mesma pasta deste script.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from PySide6.QtCore import QMimeData, QPoint, Qt, QUrl, Signal
from PySide6.QtGui import QDrag, QMouseEvent
from PySide6.QtWidgets import (
    QApplication,
    QCheckBox,
    QFileDialog,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QMainWindow,
    QProgressBar,
    QPushButton,
    QVBoxLayout,
    QWidget,
)

# ---------------------------------------------------------------------------
# Constantes
# ---------------------------------------------------------------------------

STATE_FILE = Path(__file__).resolve().parent / "skilldrop_state.json"
DRAG_THRESHOLD = 8  # pixels de movimento antes de iniciar o drag

DARK_STYLESHEET = """
QMainWindow, QWidget {
    background-color: #1e1e2e;
    color: #cdd6f4;
    font-family: "Segoe UI", "Cantarell", sans-serif;
    font-size: 13px;
}

QLineEdit {
    background-color: #313244;
    border: 1px solid #45475a;
    border-radius: 6px;
    padding: 6px 8px;
    color: #cdd6f4;
    selection-background-color: #89b4fa;
}

QLineEdit:focus {
    border: 1px solid #89b4fa;
}

QPushButton {
    background-color: #45475a;
    border: none;
    border-radius: 6px;
    padding: 7px 14px;
    color: #cdd6f4;
    font-weight: 600;
}

QPushButton:hover {
    background-color: #585b70;
}

QPushButton:pressed {
    background-color: #313244;
}

QPushButton#primaryButton {
    background-color: #89b4fa;
    color: #11111b;
}

QPushButton#primaryButton:hover {
    background-color: #a6c8ff;
}

QProgressBar {
    background-color: #313244;
    border: 1px solid #45475a;
    border-radius: 6px;
    text-align: center;
    color: #cdd6f4;
    height: 18px;
}

QProgressBar::chunk {
    background-color: #89b4fa;
    border-radius: 5px;
}

QCheckBox {
    spacing: 8px;
    color: #a6adc8;
}

QCheckBox::indicator {
    width: 16px;
    height: 16px;
    border: 1px solid #45475a;
    border-radius: 4px;
    background-color: #313244;
}

QCheckBox::indicator:checked {
    background-color: #89b4fa;
    border: 1px solid #89b4fa;
}
"""


# ---------------------------------------------------------------------------
# Lógica de estado
# ---------------------------------------------------------------------------


class StateManager:
    """Carrega e salva o estado do SkillDrop em skilldrop_state.json."""

    def __init__(self, path: Path = STATE_FILE) -> None:
        self.path = path
        self.folder: str = ""
        self.processed: list[str] = []
        self.current_index: int = 0

    def load(self) -> None:
        """Carrega o estado salvo, se existir e for válido."""
        if not self.path.exists():
            return
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
            self.folder = str(data.get("folder", ""))
            processed = data.get("processed", [])
            self.processed = [str(p) for p in processed] if isinstance(processed, list) else []
            self.current_index = int(data.get("current_index", 0))
        except (json.JSONDecodeError, OSError, ValueError):
            # Estado corrompido: começa do zero.
            self.folder = ""
            self.processed = []
            self.current_index = 0

    def save(self) -> None:
        """Persiste o estado atual em disco."""
        data = {
            "folder": self.folder,
            "processed": self.processed,
            "current_index": self.current_index,
        }
        try:
            self.path.write_text(
                json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
            )
        except OSError:
            # Não deve impedir o uso do app; apenas ignora.
            pass


# ---------------------------------------------------------------------------
# UI
# ---------------------------------------------------------------------------


class DragLabel(QLabel):
    """Label que funciona como fonte de drag para aplicativos externos."""

    dragFinished = Signal()

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self._drag_start: QPoint | None = None
        self._dragging = False
        self.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.setWordWrap(True)
        self.setMinimumHeight(150)
        self.setAcceptDrops(False)
        self.setCursor(Qt.CursorShape.OpenHandCursor)
        self.setObjectName("dragLabel")
        self._set_normal_style()

    # -- estilos -----------------------------------------------------------

    def _set_normal_style(self) -> None:
        self.setStyleSheet(
            """
            QLabel#dragLabel {
                background-color: #313244;
                border: 2px dashed #6c7086;
                border-radius: 10px;
                color: #a6adc8;
                font-size: 16px;
                padding: 12px;
            }
            """
        )

    def _set_hover_style(self) -> None:
        self.setStyleSheet(
            """
            QLabel#dragLabel {
                background-color: #313244;
                border: 2px dashed #89b4fa;
                border-radius: 10px;
                color: #cdd6f4;
                font-size: 16px;
                padding: 12px;
            }
            """
        )

    # -- eventos de mouse --------------------------------------------------

    def mousePressEvent(self, event: QMouseEvent) -> None:
        if event.button() == Qt.MouseButton.LeftButton:
            self._drag_start = event.position().toPoint()
            self._dragging = False
        super().mousePressEvent(event)

    def mouseMoveEvent(self, event: QMouseEvent) -> None:
        if self._drag_start is None:
            super().mouseMoveEvent(event)
            return

        if not (event.buttons() & Qt.MouseButton.LeftButton):
            self._drag_start = None
            super().mouseMoveEvent(event)
            return

        # Só inicia o drag depois de ultrapassar o threshold.
        if not self._dragging:
            delta = event.position().toPoint() - self._drag_start
            if delta.manhattanLength() < DRAG_THRESHOLD:
                super().mouseMoveEvent(event)
                return
            self._dragging = True
            self._start_drag()
        super().mouseMoveEvent(event)

    def mouseReleaseEvent(self, event: QMouseEvent) -> None:
        self._drag_start = None
        self._dragging = False
        super().mouseReleaseEvent(event)

    def enterEvent(self, event) -> None:  # noqa: ANN001
        self._set_hover_style()
        super().enterEvent(event)

    def leaveEvent(self, event) -> None:  # noqa: ANN001
        self._set_normal_style()
        super().leaveEvent(event)

    # -- drag para fora ----------------------------------------------------

    def _start_drag(self) -> None:
        """Inicia um QDrag com o caminho absoluto do arquivo atual."""
        file_path = self.property("filePath")
        if not file_path:
            return

        mime = QMimeData()
        mime.setUrls([QUrl.fromLocalFile(str(file_path))])

        drag = self._make_drag(mime)
        drag.exec(Qt.DropAction.CopyAction)

        # O drag terminou (com sucesso ou não). O callback decide o avanço.
        self._dragging = False
        self._drag_start = None
        self.dragFinished.emit()

    def _make_drag(self, mime: QMimeData):
        """Cria o QDrag (separado para facilitar testes)."""
        from PySide6.QtGui import QDrag

        drag = QDrag(self)
        drag.setMimeData(mime)
        return drag


class MainWindow(QMainWindow):
    """Janela principal do SkillDrop."""

    def __init__(self) -> None:
        super().__init__()
        self.setWindowTitle("SkillDrop")
        self.resize(450, 300)
        self.setMinimumSize(420, 280)

        self.state = StateManager()
        self.state.load()

        self.files: list[Path] = []  # caminhos absolutos, ordenados
        self._build_ui()
        self._connect_signals()

        # Restaura a pasta salva, se ainda existir.
        if self.state.folder and Path(self.state.folder).is_dir():
            self.folder_edit.setText(self.state.folder)
            self._scan_folder(self.state.folder)

    # -- construção da UI --------------------------------------------------

    def _build_ui(self) -> None:
        central = QWidget()
        self.setCentralWidget(central)
        layout = QVBoxLayout(central)
        layout.setContentsMargins(14, 14, 14, 14)
        layout.setSpacing(10)

        # Linha da pasta
        folder_row = QHBoxLayout()
        self.folder_edit = QLineEdit()
        self.folder_edit.setPlaceholderText("Escolha a pasta com os SKILL.md...")
        self.browse_button = QPushButton("Procurar")
        folder_row.addWidget(self.folder_edit, 1)
        folder_row.addWidget(self.browse_button)
        layout.addLayout(folder_row)

        # Área de drag
        self.drag_label = DragLabel()
        self.drag_label.setText("Escolha uma pasta para começar")
        layout.addWidget(self.drag_label, 1)

        # Barra de progresso + contador
        self.progress_bar = QProgressBar()
        self.progress_bar.setRange(0, 1)
        self.progress_bar.setValue(0)
        self.progress_label = QLabel("0 / 0 processados")
        self.progress_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        layout.addWidget(self.progress_bar)
        layout.addWidget(self.progress_label)

        # Botões
        buttons = QHBoxLayout()
        self.back_button = QPushButton("⟵ Voltar")
        self.skip_button = QPushButton("Pular →")
        self.reset_button = QPushButton("↻ Resetar")
        buttons.addWidget(self.back_button)
        buttons.addWidget(self.skip_button)
        buttons.addStretch(1)
        buttons.addWidget(self.reset_button)
        layout.addLayout(buttons)

        # Checkbox de auto-avanço
        self.auto_advance = QCheckBox("Avançar automaticamente ao arrastar")
        self.auto_advance.setChecked(True)
        layout.addWidget(self.auto_advance)

    def _connect_signals(self) -> None:
        self.browse_button.clicked.connect(self._on_browse)
        self.skip_button.clicked.connect(self._on_skip)
        self.back_button.clicked.connect(self._on_back)
        self.reset_button.clicked.connect(self._on_reset)
        self.drag_label.dragFinished.connect(self._on_drag_finished)

    # ------------------------------------------------------------------
    # Ações
    # ------------------------------------------------------------------

    def _on_browse(self) -> None:
        folder = QFileDialog.getExistingDirectory(
            self, "Escolher pasta", self.folder_edit.text() or str(Path.home())
        )
        if not folder:
            return
        self.folder_edit.setText(folder)
        self._scan_folder(folder)

    def _scan_folder(self, folder: str) -> None:
        """Escaneia recursivamente por SKILL.md e atualiza a lista."""
        folder_path = Path(folder)
        if not folder_path.is_dir():
            self._show_message("Pasta não encontrada", "A pasta selecionada não existe.")
            return

        found = sorted(folder_path.rglob("SKILL.md"), key=lambda p: p.as_posix().lower())
        if not found:
            self._show_message(
                "Nenhum arquivo encontrado",
                "Nenhum arquivo SKILL.md foi encontrado nesta pasta.",
            )
            self.files = []
            self.state.folder = folder
            self.state.processed = []
            self.state.current_index = 0
            self._refresh_ui()
            self.state.save()
            return

        self.files = found
        self.state.folder = folder

        # Mantém apenas os 'processed' que ainda existem nos novos arquivos.
        new_relative = {self._rel(p) for p in found}
        self.state.processed = [p for p in self.state.processed if p in new_relative]

        # Garante que current_index aponte para um arquivo válido.
        self.state.current_index = max(0, min(self.state.current_index, len(found) - 1))

        # Se o arquivo no índice atual já foi processado, avança para o
        # próximo não processado (evita reexibir um arquivo já concluído).
        n = len(self.files)
        if self._rel(self.files[self.state.current_index]) in self.state.processed:
            for offset in range(1, n + 1):
                idx = (self.state.current_index + offset) % n
                if self._rel(self.files[idx]) not in self.state.processed:
                    self.state.current_index = idx
                    break
            else:
                # Todos processados: mantém no último (mostra "todos processados").
                self.state.current_index = n - 1

        self._refresh_ui()
        self.state.save()

    def _on_skip(self) -> None:
        """Marca o atual como processado e avança."""
        if not self.files:
            return
        rel = self._rel(self.files[self.state.current_index])
        if rel not in self.state.processed:
            self.state.processed.append(rel)
        self._advance()

    def _on_back(self) -> None:
        """Volta para o anterior, desmarcando-o como processado."""
        if not self.files:
            return
        if self.state.current_index > 0:
            self.state.current_index -= 1
            rel = self._rel(self.files[self.state.current_index])
            if rel in self.state.processed:
                self.state.processed.remove(rel)
            self._refresh_ui()
            self.state.save()

    def _on_reset(self) -> None:
        """Zera a lista de processados e volta ao índice 0."""
        self.state.processed = []
        self.state.current_index = 0
        self._refresh_ui()
        self.state.save()

    # ------------------------------------------------------------------
    # Avanço / atualização
    # ------------------------------------------------------------------

    def _advance(self) -> None:
        """Avança para o próximo arquivo não processado."""
        if not self.files:
            return

        # Procura o próximo índice não processado a partir do atual.
        n = len(self.files)
        for offset in range(1, n + 1):
            idx = (self.state.current_index + offset) % n
            if self._rel(self.files[idx]) not in self.state.processed:
                self.state.current_index = idx
                break
        else:
            # Todos processados: mantém no último.
            self.state.current_index = n - 1

        self._refresh_ui()
        self.state.save()

    def _on_drag_finished(self) -> None:
        """Chamado após o drag do arquivo atual terminar."""
        if not self.files:
            return
        rel = self._rel(self.files[self.state.current_index])
        if rel not in self.state.processed:
            self.state.processed.append(rel)
        if self.auto_advance.isChecked():
            self._advance()
        else:
            self._refresh_ui()
            self.state.save()

    def _refresh_ui(self) -> None:
        """Atualiza todos os elementos visuais conforme o estado atual."""
        total = len(self.files)
        done = len(self.state.processed)

        if total == 0:
            self.drag_label.setText("Escolha uma pasta para começar")
            self.drag_label.setProperty("filePath", None)
            self.progress_bar.setRange(0, 1)
            self.progress_bar.setValue(0)
            self.progress_label.setText("0 de 0 processados")
            self.back_button.setEnabled(False)
            self.skip_button.setEnabled(False)
            self.reset_button.setEnabled(False)
            return

        self.progress_bar.setRange(0, total)
        self.progress_bar.setValue(done)
        self.progress_label.setText(f"{done} / {total} processados")

        self.back_button.setEnabled(self.state.current_index > 0)
        self.skip_button.setEnabled(True)
        self.reset_button.setEnabled(done > 0)

        if done >= total:
            self.drag_label.setText(f"Todos os {total} arquivos foram processados! 🎉")
            self.drag_label.setProperty("filePath", None)
            self.skip_button.setEnabled(False)
            return

        current = self.files[self.state.current_index]
        rel = self._rel(current)
        self.drag_label.setText(f"{current.name}\n\n{rel}\n\nArraste este arquivo para o Claude Code")
        self.drag_label.setProperty("filePath", str(current))

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _rel(self, path: Path) -> str:
        """Retorna o caminho relativo ao folder, em formato posix."""
        try:
            return path.relative_to(Path(self.state.folder)).as_posix()
        except ValueError:
            return path.as_posix()

    def _show_message(self, title: str, text: str) -> None:
        from PySide6.QtWidgets import QMessageBox

        QMessageBox.warning(self, title, text)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def main() -> int:
    app = QApplication(sys.argv)
    app.setStyleSheet(DARK_STYLESHEET)
    window = MainWindow()
    window.show()
    return app.exec()


if __name__ == "__main__":
    sys.exit(main())