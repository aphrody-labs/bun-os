#include <QApplication>
#include <QLabel>
#include <QTimer>

int main(int argc, char **argv) {
  QApplication app(argc, argv);
  QLabel label("hello from buncc desktop");
  label.setWindowTitle("hello qt6");
  label.resize(320, 120);
  label.show();
  QTimer::singleShot(1000, &app, &QCoreApplication::quit);
  return app.exec();
}
