#include <KAboutData>
#include <KCoreAddons>
#include <QCoreApplication>
#include <QTextStream>

int main(int argc, char **argv) {
  QCoreApplication app(argc, argv);
  KAboutData about(QStringLiteral("hello-kcoreaddons"), QStringLiteral("hello"), QStringLiteral("1.0"));
  KAboutData::setApplicationData(about);
  QTextStream out(stdout);
  out << "KCoreAddons " << KCoreAddons::versionString() << " app " << KAboutData::applicationData().componentName() << "\n";
  return 0;
}
