#include <gtk/gtk.h>

static gboolean quit_cb(gpointer app) {
  g_application_quit(G_APPLICATION(app));
  return G_SOURCE_REMOVE;
}
static void activate(GtkApplication *app, gpointer data) {
  GtkWidget *win = gtk_application_window_new(app);
  gtk_window_set_title(GTK_WINDOW(win), "hello gtk4");
  gtk_window_set_default_size(GTK_WINDOW(win), 320, 120);
  gtk_window_set_child(GTK_WINDOW(win), gtk_label_new("hello from buncc desktop"));
  gtk_window_present(GTK_WINDOW(win));
  g_timeout_add(1000, quit_cb, app);
}
int main(int argc, char **argv) {
  GtkApplication *app = gtk_application_new("org.aphrody.hello", G_APPLICATION_NON_UNIQUE);
  g_signal_connect(app, "activate", G_CALLBACK(activate), NULL);
  int rc = g_application_run(G_APPLICATION(app), argc, argv);
  g_object_unref(app);
  return rc;
}
