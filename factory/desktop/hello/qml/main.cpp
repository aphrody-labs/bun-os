#include <QGuiApplication>
#include <QQmlApplicationEngine>
#include <QTimer>

int main(int argc, char **argv) {
  QGuiApplication app(argc, argv);
  QQmlApplicationEngine engine;
  engine.loadData("import QtQuick\nWindow { visible: true; width: 320; height: 120; title: \"hello qml\"\n Text { anchors.centerIn: parent; text: \"hello from buncc desktop\" } }");
  QTimer::singleShot(1000, &app, &QCoreApplication::quit);
  return app.exec();
}
