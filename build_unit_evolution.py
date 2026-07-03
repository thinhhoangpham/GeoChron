"""Run the full unit-level evolution-pattern data build end to end."""
import build_unit_series, build_unit_sessions, build_unit_storyline_data

if __name__ == "__main__":
    build_unit_series.main()
    build_unit_sessions.main()
    build_unit_storyline_data.main()
    print("done: storyline_data_units.json ready for index_units.html")
