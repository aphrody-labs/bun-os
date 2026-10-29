/** Cross-compile smoke programs: C sources plus the pkg-config modules each one links. */
export interface Sample {
  id: "glib" | "gtk4" | "libadwaita";
  modules: string[];
  source: string;
}

export const SAMPLES: Record<Sample["id"], Sample> = {
  glib: {
    id: "glib",
    modules: ["glib-2.0", "gio-2.0"],
    source: `#include <glib.h>
#include <gio/gio.h>

int main(void) {
  GHashTable *t = g_hash_table_new_full(g_str_hash, g_str_equal, g_free, g_free);
  g_hash_table_insert(t, g_strdup("toolchain"), g_strdup_printf("glib %u.%u.%u", glib_major_version, glib_minor_version, glib_micro_version));
  GFile *f = g_file_new_for_path("/etc/os-release");
  g_print("%s %s\\n", (const char *)g_hash_table_lookup(t, "toolchain"), g_file_get_path(f));
  g_object_unref(f);
  g_hash_table_destroy(t);
  return 0;
}
`,
  },
  gtk4: {
    id: "gtk4",
    modules: ["gtk4"],
    source: `#include <gtk/gtk.h>

static void activate(GtkApplication *app, gpointer data) {
  (void)data;
  GtkWidget *w = gtk_application_window_new(app);
  gtk_window_set_title(GTK_WINDOW(w), "buncc linux cross hello");
  gtk_window_set_child(GTK_WINDOW(w), gtk_label_new("GTK4 cross-compiled with clang and lld"));
  gtk_window_present(GTK_WINDOW(w));
}

int main(int argc, char **argv) {
  g_print("gtk %u.%u.%u\\n", gtk_get_major_version(), gtk_get_minor_version(), gtk_get_micro_version());
  GtkApplication *app = gtk_application_new("org.bunos.CrossHello", G_APPLICATION_DEFAULT_FLAGS);
  g_signal_connect(app, "activate", G_CALLBACK(activate), NULL);
  int status = g_application_run(G_APPLICATION(app), argc, argv);
  g_object_unref(app);
  return status;
}
`,
  },
  libadwaita: {
    id: "libadwaita",
    modules: ["libadwaita-1"],
    source: `#include <adwaita.h>

static void activate(GtkApplication *app, gpointer data) {
  (void)data;
  GtkWidget *win = adw_application_window_new(app);
  GtkWidget *header = adw_header_bar_new();
  GtkWidget *view = adw_toolbar_view_new();
  adw_toolbar_view_add_top_bar(ADW_TOOLBAR_VIEW(view), header);
  adw_toolbar_view_set_content(ADW_TOOLBAR_VIEW(view), gtk_label_new("libadwaita cross-compiled"));
  adw_application_window_set_content(ADW_APPLICATION_WINDOW(win), view);
  gtk_window_present(GTK_WINDOW(win));
}

int main(int argc, char **argv) {
  g_print("libadwaita %u.%u.%u\\n", adw_get_major_version(), adw_get_minor_version(), adw_get_micro_version());
  AdwApplication *app = adw_application_new("org.bunos.AdwCrossHello", G_APPLICATION_DEFAULT_FLAGS);
  g_signal_connect(app, "activate", G_CALLBACK(activate), NULL);
  int status = g_application_run(G_APPLICATION(app), argc, argv);
  g_object_unref(app);
  return status;
}
`,
  },
};

/** clang command line for a sample. `flags` come from pcFlags, `target` from targetFlags/linkOnlyFlags. */
export function helloCommand(clang: string, target: string[], link: string[], cflags: string[], libs: string[], src: string, out: string): string[] {
  return [clang, ...target, ...cflags, "-O2", "-Wall", src, "-o", out, ...link, ...libs];
}
